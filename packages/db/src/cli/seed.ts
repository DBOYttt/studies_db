// Seeds the dev database with example data (subjects, classes/groups,
// lecturers, topics, tags, materials with real files, timetable sessions) and
// prints a one-time login link. Refuses to run on a non-empty database unless
// `--reset` is given, which empties every table except the migrations journal.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { sql } from 'drizzle-orm';
import { createLoginToken, upsertUser } from '../auth.js';
import { createDb } from '../client.js';
import type { Assessment, ClassKind } from '../constants.js';
import {
  fileExtension,
  originalRelPath,
  planProcessing,
  resolveStorageDir,
} from '../files.js';
import { ensureClass, ensureGroup } from '../hierarchy.js';
import { insertMaterial } from '../materials.js';
import {
  classes,
  classLecturers,
  classSessions,
  lecturers,
  subjects,
  tags,
  topics,
  topicTags,
} from '../schema.js';

const databaseUrl = process.env.DATABASE_URL;
const storageDirEnv = process.env.STORAGE_DIR;
if (!databaseUrl || !storageDirEnv) {
  console.error('DATABASE_URL and STORAGE_DIR must be set');
  process.exit(1);
}
const reset = process.argv.includes('--reset');
const storageDir = resolveStorageDir(storageDirEnv);
const webBaseUrl = process.env.WEB_BASE_URL || 'http://localhost:3000';

// ---------------------------------------------------------------- files

/** Minimal single-page PDF (Helvetica, ASCII only) with the given lines. */
function makePdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/ł/g, 'l')
      .replace(/Ł/g, 'L')
      .replace(/[^\x20-\x7e]/g, '?')
      .replace(/([\\()])/g, '\\$1');
  const body = [
    'BT /F1 18 Tf 60 780 Td',
    `(${esc(title)}) Tj`,
    '/F1 11 Tf 0 -32 Td 15 TL',
    ...lines.map((l) => `(${esc(l)}) '`),
    'ET',
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    `<< /Length ${Buffer.byteLength(body, 'latin1')} >>\nstream\n${body}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets)
    out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** 320x200 RGB PNG: a simple bar chart, deterministic per seed value. */
function makePng(seed: number): Buffer {
  const w = 320;
  const h = 200;
  const bars = Array.from(
    { length: 8 },
    (_, i) => 30 + ((seed * 37 + i * 53) % 150),
  );
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const bar = Math.floor((x - 16) / 37);
      const inBar =
        x >= 16 && bar < 8 && (x - 16) % 37 < 28 && h - 10 - y < bars[bar];
      const [r, g, b] = inBar ? [37, 99, 235] : [248, 250, 252];
      raw.set([r, g, b], row + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  py: 'text/x-python',
  c: 'text/x-c',
  sql: 'text/plain',
  png: 'image/png',
};

type FileSpec =
  | { name: string; pdf: string[] }
  | { name: string; text: string }
  | { name: string; png: number };

function render(f: FileSpec): { bytes: Buffer; text: string | null } {
  if ('pdf' in f) {
    const title = f.name.replace(/\.pdf$/, '').replace(/[_-]/g, ' ');
    return {
      bytes: makePdf(title, f.pdf),
      text: `${title}\n${f.pdf.join('\n')}`,
    };
  }
  if ('text' in f) return { bytes: Buffer.from(f.text, 'utf8'), text: f.text };
  return { bytes: makePng(f.png), text: null };
}

// ---------------------------------------------------------------- data

interface LecturerSpec {
  key: string;
  title: string;
  name: string;
  email: string;
  officeHours?: string;
  room?: string;
}

const LECTURERS: LecturerSpec[] = [
  {
    key: 'nowak',
    title: 'dr hab.',
    name: 'Anna Nowak',
    email: 'anna.nowak@example.edu',
    officeHours: 'pon. 12:00-13:30',
    room: 'B-1 214',
  },
  {
    key: 'kowalski',
    title: 'prof. dr hab.',
    name: 'Jan Kowalski',
    email: 'jan.kowalski@example.edu',
    officeHours: 'śr. 10:00-11:30',
    room: 'B-1 301',
  },
  {
    key: 'wisniewska',
    title: 'dr inż.',
    name: 'Maria Wiśniewska',
    email: 'maria.wisniewska@example.edu',
    officeHours: 'wt. 14:00-15:00',
    room: 'C-2 112',
  },
  {
    key: 'zielinski',
    title: 'mgr inż.',
    name: 'Tomasz Zieliński',
    email: 'tomasz.zielinski@example.edu',
    room: 'C-2 015',
  },
  {
    key: 'lewandowska',
    title: 'dr',
    name: 'Katarzyna Lewandowska',
    email: 'katarzyna.lewandowska@example.edu',
    officeHours: 'czw. 9:30-11:00',
    room: 'A-0 204',
  },
  {
    key: 'wojcik',
    title: 'dr inż.',
    name: 'Piotr Wójcik',
    email: 'piotr.wojcik@example.edu',
    officeHours: 'pt. 11:00-12:00',
    room: 'D-3 117',
  },
  {
    key: 'kaminski',
    title: 'mgr',
    name: 'Michał Kamiński',
    email: 'michal.kaminski@example.edu',
  },
  {
    key: 'dabrowska',
    title: 'mgr',
    name: 'Joanna Dąbrowska',
    email: 'joanna.dabrowska@example.edu',
    officeHours: 'pon. 15:00-16:00',
    room: 'S-1 08',
  },
];

const STUDENTS = [
  { discordUserId: 'seed-u1', displayName: 'Ola Jankowska' },
  { discordUserId: 'seed-u2', displayName: 'Kuba Mazur' },
  { discordUserId: 'seed-u3', displayName: 'Zuzia Krawczyk' },
  { discordUserId: 'seed-u4', displayName: 'Bartek Piotrowski' },
  { discordUserId: 'seed-u5', displayName: 'Natalia Grabowska' },
];

interface ClassSpec {
  kind: ClassKind;
  groups: number[];
  lecturer: string; // whole class
  groupLecturers?: Record<number, string>;
  assessment?: Assessment;
  assessmentNote?: string;
  platformUrl?: string;
  // timetable: weekday (1 = Mon), start "HH:MM", minutes, room; one slot per group (or one for the class)
  slots: {
    day: number;
    start: string;
    minutes: number;
    room: string;
    group?: number;
  }[];
}

interface TopicSpec {
  title: string;
  kind?: ClassKind;
  group?: number;
  tags?: string[];
  by: number; // index into STUDENTS
  daysAgo: number;
  files: FileSpec[];
}

interface SubjectSpec {
  code: string;
  name: string;
  semester: number;
  ects: number;
  description: string;
  platformUrl?: string;
  tags: string[];
  classes: ClassSpec[];
  topics: TopicSpec[];
}

const SUBJECTS: SubjectSpec[] = [
  {
    code: 'ASD',
    name: 'Algorytmy i struktury danych',
    semester: 3,
    ects: 6,
    description:
      'Złożoność obliczeniowa, sortowanie, drzewa, grafy, programowanie dynamiczne.',
    platformUrl: 'https://upel.example.edu/course/asd',
    tags: ['Kolokwium', 'Egzamin', 'Notatki', 'Zadania'],
    classes: [
      {
        kind: 'wyklad',
        groups: [],
        lecturer: 'kowalski',
        assessment: 'egzamin',
        assessmentNote: 'Egzamin pisemny w sesji, próg 50%',
        slots: [{ day: 1, start: '08:00', minutes: 90, room: 'A-1 101' }],
      },
      {
        kind: 'laboratorium',
        groups: [1, 2, 3],
        lecturer: 'zielinski',
        groupLecturers: { 3: 'kaminski' },
        assessment: 'sprawozdania',
        platformUrl: 'https://upel.example.edu/course/asd-lab',
        slots: [
          { day: 2, start: '10:00', minutes: 90, room: 'C-2 015', group: 1 },
          { day: 2, start: '12:00', minutes: 90, room: 'C-2 015', group: 2 },
          { day: 4, start: '14:00', minutes: 90, room: 'C-2 016', group: 3 },
        ],
      },
      {
        kind: 'cwiczenia',
        groups: [1, 2],
        lecturer: 'nowak',
        assessment: 'kolokwium',
        slots: [
          { day: 3, start: '08:00', minutes: 90, room: 'B-1 110', group: 1 },
          { day: 3, start: '09:45', minutes: 90, room: 'B-1 110', group: 2 },
        ],
      },
    ],
    topics: [
      {
        title: 'Wykład 1 — złożoność i notacja O',
        kind: 'wyklad',
        tags: ['Notatki'],
        by: 0,
        daysAgo: 21,
        files: [
          {
            name: 'wyklad01-zlozonosc.pdf',
            pdf: [
              'Notacja O, Omega, Theta.',
              'Przyklady: wyszukiwanie liniowe O(n), binarne O(log n).',
              'Twierdzenie o rekurencji uniwersalnej (master theorem).',
            ],
          },
        ],
      },
      {
        title: 'Wykład 2 — sortowanie',
        kind: 'wyklad',
        tags: ['Notatki'],
        by: 0,
        daysAgo: 14,
        files: [
          {
            name: 'wyklad02-sortowanie.pdf',
            pdf: [
              'Sortowanie przez wstawianie, scalanie, szybkie.',
              'Dolne ograniczenie Omega(n log n) dla sortowania porownujacego.',
              'Sortowanie przez zliczanie i pozycyjne.',
            ],
          },
          { name: 'porownanie-czasow.png', png: 2 },
        ],
      },
      {
        title: 'Lab 1 — kopiec binarny',
        kind: 'laboratorium',
        group: 1,
        tags: ['Zadania'],
        by: 1,
        daysAgo: 12,
        files: [
          {
            name: 'heap.py',
            text: 'class MinHeap:\n    def __init__(self):\n        self.a = []\n\n    def push(self, x):\n        self.a.append(x)\n        i = len(self.a) - 1\n        while i > 0 and self.a[(i - 1) // 2] > self.a[i]:\n            p = (i - 1) // 2\n            self.a[i], self.a[p] = self.a[p], self.a[i]\n            i = p\n\n    def pop(self):\n        a = self.a\n        a[0], a[-1] = a[-1], a[0]\n        top = a.pop()\n        i = 0\n        while True:\n            l, r, m = 2 * i + 1, 2 * i + 2, i\n            if l < len(a) and a[l] < a[m]:\n                m = l\n            if r < len(a) and a[r] < a[m]:\n                m = r\n            if m == i:\n                return top\n            a[i], a[m] = a[m], a[i]\n            i = m\n',
          },
          {
            name: 'lab1-tresc.pdf',
            pdf: [
              'Zaimplementuj kopiec binarny typu min.',
              'Operacje: push, pop, peek, heapify.',
              'Termin oddania: przed nastepnymi zajeciami.',
            ],
          },
        ],
      },
      {
        title: 'Lab 2 — grafy BFS/DFS',
        kind: 'laboratorium',
        group: 2,
        tags: ['Zadania'],
        by: 3,
        daysAgo: 5,
        files: [
          {
            name: 'bfs.c',
            text: '#include <stdio.h>\n\n#define N 6\n\nint adj[N][N] = {\n  {0,1,1,0,0,0}, {1,0,0,1,0,0}, {1,0,0,1,1,0},\n  {0,1,1,0,0,1}, {0,0,1,0,0,1}, {0,0,0,1,1,0},\n};\n\nint main(void) {\n  int q[N], head = 0, tail = 0, seen[N] = {0};\n  q[tail++] = 0; seen[0] = 1;\n  while (head < tail) {\n    int v = q[head++];\n    printf("%d ", v);\n    for (int u = 0; u < N; u++)\n      if (adj[v][u] && !seen[u]) { seen[u] = 1; q[tail++] = u; }\n  }\n  putchar(\'\\n\');\n  return 0;\n}\n',
          },
        ],
      },
      {
        title: 'Kolokwium 1 — zadania z poprzednich lat',
        kind: 'cwiczenia',
        group: 1,
        tags: ['Kolokwium'],
        by: 2,
        daysAgo: 3,
        files: [
          {
            name: 'kolokwium1-2025.pdf',
            pdf: [
              'Zad. 1. Rozwiaz rekurencje T(n) = 2T(n/2) + n.',
              'Zad. 2. Udowodnij poprawnosc sortowania przez wstawianie.',
              'Zad. 3. Zaprojektuj algorytm O(n log n) znajdowania pary o sumie k.',
            ],
          },
          {
            name: 'rozwiazania.md',
            text: '# Rozwiązania — kolokwium 1 (2025)\n\n## Zad. 1\nZ twierdzenia o rekurencji uniwersalnej: T(n) = Θ(n log n).\n\n## Zad. 2\nNiezmiennik pętli: prefiks a[0..i-1] jest posortowany.\n\n## Zad. 3\nSortujemy, potem dwa wskaźniki z obu końców.\n',
          },
        ],
      },
      {
        title: 'Egzamin — zakres materiału',
        tags: ['Egzamin'],
        by: 4,
        daysAgo: 1,
        files: [
          {
            name: 'zakres-egzaminu.txt',
            text: 'Zakres egzaminu z ASD:\n- złożoność, rekurencje\n- sortowanie (wszystkie omówione algorytmy)\n- kopce, drzewa BST, AVL\n- grafy: BFS, DFS, Dijkstra, MST\n- programowanie dynamiczne\n',
          },
        ],
      },
    ],
  },
  {
    code: 'BD',
    name: 'Bazy danych',
    semester: 3,
    ects: 5,
    description: 'Model relacyjny, SQL, normalizacja, transakcje, indeksy.',
    platformUrl: 'https://upel.example.edu/course/bd',
    tags: ['Kolokwium', 'Projekt', 'Notatki'],
    classes: [
      {
        kind: 'wyklad',
        groups: [],
        lecturer: 'wisniewska',
        assessment: 'egzamin',
        slots: [{ day: 1, start: '10:00', minutes: 90, room: 'A-1 102' }],
      },
      {
        kind: 'laboratorium',
        groups: [1, 2],
        lecturer: 'wisniewska',
        groupLecturers: { 2: 'zielinski' },
        assessment: 'kolokwium',
        assessmentNote: 'Dwa kolokwia praktyczne z SQL',
        slots: [
          { day: 4, start: '08:00', minutes: 90, room: 'C-2 112', group: 1 },
          { day: 4, start: '09:45', minutes: 90, room: 'C-2 112', group: 2 },
        ],
      },
      {
        kind: 'projekt',
        groups: [],
        lecturer: 'wisniewska',
        assessment: 'projekt',
        assessmentNote: 'Projekt bazy danych w zespołach 2-3 os.',
        slots: [{ day: 5, start: '12:00', minutes: 90, room: 'C-2 113' }],
      },
    ],
    topics: [
      {
        title: 'Wykład — normalizacja (1NF–BCNF)',
        kind: 'wyklad',
        tags: ['Notatki'],
        by: 1,
        daysAgo: 13,
        files: [
          {
            name: 'normalizacja.pdf',
            pdf: [
              'Zaleznosci funkcyjne i klucze.',
              '1NF, 2NF, 3NF, BCNF - definicje i przyklady.',
              'Dekompozycja bezstratna i zachowujaca zaleznosci.',
            ],
          },
        ],
      },
      {
        title: 'Lab — zapytania JOIN',
        kind: 'laboratorium',
        group: 1,
        tags: ['Notatki'],
        by: 0,
        daysAgo: 8,
        files: [
          {
            name: 'joiny.sql',
            text: '-- INNER vs LEFT JOIN\nSELECT s.name, COUNT(t.id) AS topics\nFROM subjects s\nLEFT JOIN topics t ON t.subject_id = s.id\nGROUP BY s.id\nORDER BY topics DESC;\n',
          },
        ],
      },
      {
        title: 'Projekt — wymagania i harmonogram',
        kind: 'projekt',
        tags: ['Projekt'],
        by: 2,
        daysAgo: 6,
        files: [
          {
            name: 'projekt-wymagania.pdf',
            pdf: [
              'Min. 8 tabel, diagram ERD, skrypt DDL.',
              'Co najmniej 3 widoki i 2 wyzwalacze.',
              'Oddanie: tydzien przed koncem semestru.',
            ],
          },
          { name: 'erd-przyklad.png', png: 5 },
        ],
      },
      {
        title: 'Kolokwium SQL gr 2 — przykładowe zadania',
        kind: 'laboratorium',
        group: 2,
        tags: ['Kolokwium'],
        by: 3,
        daysAgo: 2,
        files: [
          {
            name: 'kolokwium-sql-przyklad.txt',
            text: '1. Wypisz przedmioty bez żadnych materiałów.\n2. Dla każdego prowadzącego podaj liczbę grup.\n3. Znajdź tematy utworzone w ostatnim tygodniu.\n',
          },
        ],
      },
    ],
  },
  {
    code: 'SO',
    name: 'Systemy operacyjne',
    semester: 3,
    ects: 5,
    description:
      'Procesy, wątki, synchronizacja, pamięć wirtualna, systemy plików.',
    tags: ['Kolokwium', 'Notatki', 'Zadania'],
    classes: [
      {
        kind: 'wyklad',
        groups: [],
        lecturer: 'wojcik',
        assessment: 'egzamin',
        slots: [{ day: 2, start: '08:00', minutes: 90, room: 'A-1 101' }],
      },
      {
        kind: 'laboratorium',
        groups: [1, 2],
        lecturer: 'wojcik',
        groupLecturers: { 2: 'kaminski' },
        assessment: 'zaliczenie',
        platformUrl: 'https://upel.example.edu/course/so-lab',
        slots: [
          { day: 3, start: '12:00', minutes: 90, room: 'D-3 010', group: 1 },
          { day: 3, start: '14:00', minutes: 90, room: 'D-3 010', group: 2 },
        ],
      },
    ],
    topics: [
      {
        title: 'Wykład — szeregowanie procesów',
        kind: 'wyklad',
        tags: ['Notatki'],
        by: 4,
        daysAgo: 15,
        files: [
          {
            name: 'szeregowanie.pdf',
            pdf: [
              'FCFS, SJF, Round Robin, priorytety.',
              'Wywlaszczanie i przelaczanie kontekstu.',
              'Zaglodzenie i postarzanie (aging).',
            ],
          },
        ],
      },
      {
        title: 'Lab — fork() i potoki',
        kind: 'laboratorium',
        group: 1,
        tags: ['Zadania'],
        by: 1,
        daysAgo: 9,
        files: [
          {
            name: 'fork_pipe.c',
            text: '#include <stdio.h>\n#include <unistd.h>\n#include <sys/wait.h>\n\nint main(void) {\n  int fd[2];\n  pipe(fd);\n  if (fork() == 0) {\n    close(fd[0]);\n    write(fd[1], "czesc\\n", 6);\n    return 0;\n  }\n  close(fd[1]);\n  char buf[16];\n  ssize_t n = read(fd[0], buf, sizeof buf);\n  write(1, buf, n);\n  wait(NULL);\n  return 0;\n}\n',
          },
        ],
      },
      {
        title: 'Semafory — notatki z ćwiczeń',
        tags: ['Notatki'],
        by: 2,
        daysAgo: 4,
        files: [
          {
            name: 'semafory.md',
            text: '# Semafory\n\n- `P(s)` / `wait`: zmniejsz, czekaj jeśli < 0\n- `V(s)` / `signal`: zwiększ, obudź czekającego\n\nProblem producenta-konsumenta: dwa semafory zliczające + mutex.\n',
          },
        ],
      },
    ],
  },
  {
    code: 'AM2',
    name: 'Analiza matematyczna 2',
    semester: 3,
    ects: 6,
    description: 'Funkcje wielu zmiennych, całki wielokrotne, szeregi.',
    tags: ['Kolokwium', 'Egzamin', 'Zadania'],
    classes: [
      {
        kind: 'wyklad',
        groups: [],
        lecturer: 'lewandowska',
        assessment: 'egzamin',
        slots: [{ day: 5, start: '08:00', minutes: 90, room: 'A-0 001' }],
      },
      {
        kind: 'cwiczenia',
        groups: [1, 2, 3],
        lecturer: 'lewandowska',
        groupLecturers: { 2: 'nowak', 3: 'nowak' },
        assessment: 'kolokwium',
        slots: [
          { day: 5, start: '10:00', minutes: 90, room: 'A-0 204', group: 1 },
          { day: 1, start: '12:00', minutes: 90, room: 'A-0 204', group: 2 },
          { day: 1, start: '14:00', minutes: 90, room: 'A-0 205', group: 3 },
        ],
      },
    ],
    topics: [
      {
        title: 'Lista zadań 1 — pochodne cząstkowe',
        kind: 'cwiczenia',
        group: 1,
        tags: ['Zadania'],
        by: 3,
        daysAgo: 18,
        files: [
          {
            name: 'lista1.pdf',
            pdf: [
              '1. Oblicz pochodne czastkowe f(x,y) = x^2 y + sin(xy).',
              '2. Wyznacz gradient i rozniczke zupelna.',
              '3. Znajdz ekstrema lokalne f(x,y) = x^3 + y^3 - 3xy.',
            ],
          },
        ],
      },
      {
        title: 'Kolokwium 1 — gr 3',
        kind: 'cwiczenia',
        group: 3,
        tags: ['Kolokwium'],
        by: 0,
        daysAgo: 7,
        files: [
          {
            name: 'kolokwium1-gr3.pdf',
            pdf: [
              "Zad. 1. Ekstrema warunkowe - mnozniki Lagrange'a.",
              'Zad. 2. Calka podwojna po trojkacie.',
              'Zad. 3. Zbieznosc szeregu sum 1/n^p.',
            ],
          },
        ],
      },
    ],
  },
  {
    code: 'SK',
    name: 'Sieci komputerowe',
    semester: 3,
    ects: 4,
    description:
      'Model OSI/TCP-IP, adresacja, routing, protokoły warstwy aplikacji.',
    tags: ['Notatki', 'Sprawozdanie'],
    classes: [
      {
        kind: 'wyklad',
        groups: [],
        lecturer: 'wojcik',
        assessment: 'zaliczenie',
        slots: [{ day: 4, start: '12:00', minutes: 90, room: 'A-1 103' }],
      },
      {
        kind: 'laboratorium',
        groups: [1, 2],
        lecturer: 'zielinski',
        assessment: 'sprawozdania',
        slots: [
          { day: 2, start: '14:00', minutes: 90, room: 'D-3 112', group: 1 },
          { day: 2, start: '16:00', minutes: 90, room: 'D-3 112', group: 2 },
        ],
      },
    ],
    topics: [
      {
        title: 'Adresacja IPv4 i podsieci',
        kind: 'wyklad',
        tags: ['Notatki'],
        by: 1,
        daysAgo: 10,
        files: [
          {
            name: 'podsieci.txt',
            text: '192.168.10.0/26 -> 4 podsieci po 62 hosty\nmaska: 255.255.255.192\nbroadcast pierwszej: 192.168.10.63\n',
          },
        ],
      },
      {
        title: 'Sprawozdanie — Wireshark, analiza TCP',
        kind: 'laboratorium',
        group: 2,
        tags: ['Sprawozdanie'],
        by: 4,
        daysAgo: 3,
        files: [
          {
            name: 'sprawozdanie-wireshark.pdf',
            pdf: [
              'Cel: analiza nawiazania polaczenia TCP (3-way handshake).',
              'Zaobserwowano SYN, SYN-ACK, ACK oraz okno 64240 B.',
              'Wnioski: retransmisje przy utracie pakietow.',
            ],
          },
          { name: 'rtt-wykres.png', png: 9 },
        ],
      },
    ],
  },
  {
    code: 'JA',
    name: 'Język angielski B2',
    semester: 3,
    ects: 2,
    description: 'Angielski techniczny, prezentacje, pisanie dokumentacji.',
    tags: [],
    classes: [
      {
        kind: 'cwiczenia',
        groups: [1],
        lecturer: 'dabrowska',
        assessment: 'zaliczenie',
        slots: [
          { day: 3, start: '16:00', minutes: 90, room: 'S-1 08', group: 1 },
        ],
      },
    ],
    topics: [],
  },
];

// ---------------------------------------------------------------- seeding

/** Monday 00:00 of the current week as a wall Date (UTC fields == local wall clock). */
function currentMonday(): Date {
  const n = new Date();
  const wall = new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()));
  const dow = (wall.getUTCDay() + 6) % 7;
  wall.setUTCDate(wall.getUTCDate() - dow);
  return wall;
}

const { db, pool } = createDb(databaseUrl);
try {
  const [[{ n }]] = (await db.execute(
    sql`SELECT COUNT(*) AS n FROM subjects`,
  )) as unknown as [[{ n: number }]];
  if (Number(n) > 0) {
    if (!reset) {
      console.error(
        'Database already has data. Re-run with --reset to empty it first (pnpm db:seed --reset).',
      );
      process.exit(1);
    }
    // One connection, so SET FOREIGN_KEY_CHECKS applies to the TRUNCATEs.
    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.query<import('mysql2').RowDataPacket[]>(
        "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> '__drizzle_migrations'",
      );
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const { t } of rows) await conn.query(`TRUNCATE TABLE \`${t}\``);
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      conn.release();
    }
    console.log('emptied existing data');
  }

  const userIds: number[] = [];
  for (const s of STUDENTS) {
    userIds.push(await upsertUser(db, { ...s, avatarUrl: null }));
  }

  const lecturerIds = new Map<string, number>();
  for (const { key, ...l } of LECTURERS) {
    const [{ id }] = await db.insert(lecturers).values(l).$returningId();
    lecturerIds.set(key, id);
  }

  const monday = currentMonday();
  const sessionRows: (typeof classSessions.$inferInsert)[] = [];
  let attachment = 0;
  let fileCount = 0;

  for (const [si, s] of SUBJECTS.entries()) {
    const [{ id: subjectId }] = await db
      .insert(subjects)
      .values({
        code: s.code,
        name: s.name,
        semester: s.semester,
        ects: s.ects,
        description: s.description,
        platformUrl: s.platformUrl,
      })
      .$returningId();

    const tagIds = new Map<string, number>();
    for (const [ti, name] of s.tags.entries()) {
      const [{ id }] = await db
        .insert(tags)
        .values({ subjectId, name, discordTagId: `seed-tag-${si}-${ti}` })
        .$returningId();
      tagIds.set(name, id);
    }

    const classIds = new Map<ClassKind, number>();
    const groupIds = new Map<string, number>();
    for (const c of s.classes) {
      const classId = await ensureClass(db, subjectId, c.kind);
      classIds.set(c.kind, classId);
      await db
        .update(classes)
        .set({
          assessment: c.assessment,
          assessmentNote: c.assessmentNote,
          platformUrl: c.platformUrl,
        })
        .where(sql`${classes.id} = ${classId}`);
      for (const g of c.groups) {
        groupIds.set(`${c.kind}:${g}`, await ensureGroup(db, classId, g));
      }
      await db.insert(classLecturers).values({
        classId,
        lecturerId: lecturerIds.get(c.lecturer) as number,
        groupId: null,
      });
      for (const [g, key] of Object.entries(c.groupLecturers ?? {})) {
        await db.insert(classLecturers).values({
          classId,
          lecturerId: lecturerIds.get(key) as number,
          groupId: groupIds.get(`${c.kind}:${g}`) as number,
        });
      }

      // Timetable: previous week through four weeks ahead.
      for (const slot of c.slots) {
        const [hh, mm] = slot.start.split(':').map(Number);
        const groupId = slot.group
          ? (groupIds.get(`${c.kind}:${slot.group}`) as number)
          : null;
        const lecturerKey =
          (slot.group && c.groupLecturers?.[slot.group]) || c.lecturer;
        const uid = `seed-${s.code}-${c.kind}-${slot.group ?? 0}`;
        for (let week = -1; week <= 4; week++) {
          const start = new Date(monday);
          start.setUTCDate(start.getUTCDate() + week * 7 + slot.day - 1);
          start.setUTCHours(hh, mm);
          const end = new Date(start.getTime() + slot.minutes * 60_000);
          const label = slot.group
            ? `${s.name} — ${c.kind === 'wyklad' ? 'Wykład' : c.kind[0].toUpperCase() + c.kind.slice(1)} gr ${slot.group}`
            : `${s.name} — Wykład`;
          sessionRows.push({
            uid,
            occurrenceStart: start,
            subjectId,
            classId,
            groupId,
            lecturerId: lecturerIds.get(lecturerKey) as number,
            label,
            room: slot.room,
            startsAt: start,
            endsAt: end,
            // One cancelled occurrence next week, to show the status.
            status:
              s.code === 'SO' && c.kind === 'wyklad' && week === 1
                ? 'cancelled'
                : 'confirmed',
          });
        }
      }
    }

    for (const [ti, t] of s.topics.entries()) {
      const createdAt = new Date(Date.now() - t.daysAgo * 86_400_000);
      const [{ id: topicId }] = await db
        .insert(topics)
        .values({
          subjectId,
          title: t.title,
          discordThreadId: `seed-thread-${si}-${ti}`,
          createdBy: userIds[t.by],
          classId: t.kind ? classIds.get(t.kind) : null,
          groupId:
            t.kind && t.group ? groupIds.get(`${t.kind}:${t.group}`) : null,
          createdAt,
        })
        .$returningId();
      for (const name of t.tags ?? []) {
        await db
          .insert(topicTags)
          .values({ topicId, tagId: tagIds.get(name) as number });
      }

      for (const f of t.files) {
        const { bytes, text } = render(f);
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        const ext = fileExtension(f.name);
        const rel = originalRelPath(sha256, ext);
        const abs = join(storageDir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, bytes);
        const mime = MIME[ext] ?? 'application/octet-stream';
        const { previewKind } = planProcessing(f.name, mime);
        attachment++;
        await insertMaterial(
          db,
          {
            topicId,
            uploaderId: userIds[t.by],
            discordMessageId: `seed-msg-${si}-${ti}`,
            discordAttachmentId: `seed-att-${attachment}`,
            originalFilename: f.name,
            mimeType: mime,
            sizeBytes: bytes.length,
            sha256,
            storagePath: rel,
            previewKind,
            extractedText: text,
            status: 'ready',
            createdAt,
          },
          [], // already "processed": no worker jobs
        );
        fileCount++;
      }
    }
  }

  await db.insert(classSessions).values(sessionRows);

  const token = await createLoginToken(db, userIds[0]);
  console.log(
    `seeded ${SUBJECTS.length} subjects, ${LECTURERS.length} lecturers, ${STUDENTS.length} users, ${fileCount} files, ${sessionRows.length} timetable sessions`,
  );
  console.log(`files written to ${storageDir}`);
  console.log(
    `\nLogin link for ${STUDENTS[0].displayName} (valid 15 min, single use):`,
  );
  console.log(`${webBaseUrl}/auth/callback?token=${token}`);
} finally {
  await pool.end();
}
