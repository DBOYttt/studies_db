// Core of the dev seed (`pnpm db:seed`, also run by `qa.ts sandbox` and
// test/seed.test.ts): example data for every feature, written through the
// domain functions (events, series, entry quizzes, My groups, reminders) so
// it is consistent, audited and queued for the bot like real data.
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { asc, count, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type mysql from 'mysql2/promise';
import { writeAudit } from '../audit.js';
import { upsertUser } from '../auth.js';
import { enqueueBotRequest } from '../bot-requests.js';
import { addMark, removeMark, skipDate } from '../class-marks.js';
import type { Db } from '../client.js';
import type { Assessment, ClassKind } from '../constants.js';
import { addSeries } from '../event-series.js';
import { addEvent, deleteEvent, editEvent, linkTopic } from '../events.js';
import {
  fileExtension,
  originalRelPath,
  planProcessing,
  resolveInStorage,
} from '../files.js';
import { ensureClass, ensureGroup } from '../hierarchy.js';
import { insertMaterial } from '../materials.js';
import { setMyGroup } from '../my-groups.js';
import { isoWeekOf, nowWall, weekStart } from '../plan.js';
import { setReminderPrefs } from '../reminders.js';
import {
  botRequests,
  botSettings,
  classes,
  classLecturers,
  classMarks,
  classSessions,
  eventSeries,
  events,
  lecturers,
  subjects,
  tags,
  topics,
  topicTags,
  users,
  webUploads,
} from '../schema.js';

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
    semester: 1,
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
    semester: 1,
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
    semester: 1,
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
    semester: 1,
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
    semester: 1,
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
        // Search: "lacze" finds this (ł folded, other diacritics by collation).
        title: 'Łącza i media transmisyjne',
        kind: 'wyklad',
        tags: ['Notatki'],
        by: 2,
        daysAgo: 11,
        files: [
          {
            name: 'lacza-notatki.txt',
            text: 'Łącze szeregowe a równoległe.\nPrzepustowość łącza zależy od pasma i stosunku sygnału do szumu (wzór Shannona).\nŚwiatłowód: tłumienie, dyspersja, złącza SC/LC.\n',
          },
        ],
      },
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
    semester: 1,
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

/** The database already has data and `reset` was not given. */
export class SeedRefusedError extends Error {}

export interface SeedOptions {
  /** Absolute STORAGE_DIR; files are written under it. */
  storageDir: string;
  /** Empty the database first (keeps the Discord wiring and real users). */
  reset?: boolean;
  log?: (line: string) => void;
}

export interface SeedSummary {
  subjects: number;
  lecturers: number;
  users: number;
  files: number;
  /** Timetable rows, exams included. */
  sessions: number;
  exams: number;
  /** `events` rows: single events, series occurrences and the deleted one. */
  events: number;
  series: number;
  /** Active entry quizzes. */
  marks: number;
  botRequests: number;
  /** Who the CLI prints login links for. */
  loginUsers: { student: number; admin: number };
  /** What `reset` kept (all empty without it). */
  kept: {
    settings: number;
    users: string[];
    relinked: string[];
    dropped: string[];
  };
}

const SPECIAL_USERS = {
  admin: { discordUserId: 'seed-admin', displayName: 'Marta Starościna' },
  banned: { discordUserId: 'seed-banned', displayName: 'Mirek Zablokowany' },
};

/** Imported exams (`class_sessions` kind 'exam', source 'exams', no class). */
const EXAMS = [
  {
    code: 'ASD',
    week: 3,
    day: 6,
    start: '10:00',
    minutes: 120,
    room: 'A-1 101',
    lecturer: 'kowalski',
  },
  {
    code: 'SO',
    week: 3,
    day: 6,
    start: '13:00',
    minutes: 120,
    room: 'A-1 102',
    lecturer: 'wojcik',
  },
  {
    code: 'BD',
    week: 4,
    day: 6,
    start: '10:00',
    minutes: 120,
    room: 'A-1 102',
    lecturer: 'wisniewska',
  },
];

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The "Kiedy" text (`DD.MM.YYYY [HH:MM[-HH:MM]]`) of a wall day. */
function when(day: Date, from?: string, to?: string): string {
  const d = `${pad(day.getUTCDate())}.${pad(day.getUTCMonth() + 1)}.${day.getUTCFullYear()}`;
  if (!from) return d;
  return `${d} ${from}${to ? `-${to}` : ''}`;
}

function must<T extends { ok: boolean; message: string }>(
  what: string,
  r: T,
): T & { id: number } {
  const id = (r as { id?: number }).id;
  if (!r.ok) throw new Error(`seed: ${what}: ${r.message}`);
  return { ...r, id: id as number };
}

type Kept = SeedSummary['kept'];

/**
 * `--reset`: empties every base table of this database (DATABASE()) except
 * the migrations journal, `bot_settings` and `users`, then deletes the users
 * that are not real Discord accounts (non-numeric ids). FK checks are off
 * only for the TRUNCATEs (InnoDB refuses TRUNCATE of a referenced table);
 * the DELETE runs with them on, when every referencing table is already
 * empty. Returns the subject → forum links to restore by code.
 */
async function emptyForReset(
  db: Db,
  pool: mysql.Pool,
): Promise<{ links: { code: string; channelId: string }[]; kept: Kept }> {
  const links = (
    await db
      .select({ code: subjects.code, channelId: subjects.discordChannelId })
      .from(subjects)
      .where(isNotNull(subjects.discordChannelId))
      .orderBy(asc(subjects.code))
  ).map((l) => ({ code: l.code, channelId: l.channelId as string }));
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT table_name AS t FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
          AND table_name NOT IN ('__drizzle_migrations', 'bot_settings', 'users')`,
    );
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    try {
      for (const { t } of rows) await conn.query(`TRUNCATE TABLE \`${t}\``);
    } finally {
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    await conn.query(
      "DELETE FROM users WHERE discord_user_id NOT REGEXP '^[0-9]+$'",
    );
  } finally {
    conn.release();
  }
  const keptUsers = await db
    .select({ name: users.displayName })
    .from(users)
    .orderBy(asc(users.id));
  const [{ n }] = await db.select({ n: count() }).from(botSettings);
  return {
    links,
    kept: {
      settings: Number(n),
      users: keptUsers.map((u) => u.name),
      relinked: [],
      dropped: [],
    },
  };
}

export async function seedDatabase(
  db: Db,
  opts: SeedOptions,
): Promise<SeedSummary> {
  const log = opts.log ?? console.log;
  const pool = (db as unknown as { $client: mysql.Pool }).$client;
  const storageDir = opts.storageDir;
  const [[{ n }]] = (await db.execute(
    sql`SELECT COUNT(*) AS n FROM subjects`,
  )) as unknown as [[{ n: number }]];
  let links: { code: string; channelId: string }[] = [];
  let kept: Kept = { settings: 0, users: [], relinked: [], dropped: [] };
  if (Number(n) > 0) {
    if (!opts.reset) {
      throw new SeedRefusedError(
        'Database already has data. Re-run with --reset to empty it first (pnpm db:seed --reset).',
      );
    }
    ({ links, kept } = await emptyForReset(db, pool));
    log(
      `emptied existing data; kept bot_settings (${kept.settings} keys) and ${kept.users.length} real users${kept.users.length ? ` (${kept.users.join(', ')})` : ''}`,
    );
  }

  const userIds: number[] = [];
  for (const s of STUDENTS) {
    userIds.push(await upsertUser(db, { ...s, avatarUrl: null }));
  }
  const [u1, u2, u3, u4, u5] = userIds;
  const adminId = await upsertUser(db, {
    ...SPECIAL_USERS.admin,
    avatarUrl: null,
  });
  await db.update(users).set({ isAdmin: true }).where(eq(users.id, adminId));
  const bannedId = await upsertUser(db, {
    ...SPECIAL_USERS.banned,
    avatarUrl: null,
  });
  await db.update(users).set({ isBanned: true }).where(eq(users.id, bannedId));

  const lecturerIds = new Map<string, number>();
  for (const { key, ...l } of LECTURERS) {
    const [{ id }] = await db.insert(lecturers).values(l).$returningId();
    lecturerIds.set(key, id);
  }

  const wallNow = nowWall();
  const monday = weekStart(isoWeekOf(wallNow));
  /** Midnight today (wall). */
  const today = new Date(
    Date.UTC(
      wallNow.getUTCFullYear(),
      wallNow.getUTCMonth(),
      wallNow.getUTCDate(),
    ),
  );
  /** Wall start of `HH:MM` on weekday `day` (1 = Mon) of week `week` (0 = this one). */
  const at = (week: number, day: number, hhmm: string) => {
    const [hh, mm] = hhmm.split(':').map(Number);
    const d = addDays(monday, week * 7 + day - 1);
    d.setUTCHours(hh, mm);
    return d;
  };
  const sessionRows: (typeof classSessions.$inferInsert)[] = [];
  const subjectIds = new Map<string, number>();
  const classIdOf = new Map<string, number>(); // `${code}:${kind}`
  const groupIdOf = new Map<string, number>(); // `${code}:${kind}:${n}`
  const topicIdOf = new Map<string, number>(); // title
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
    subjectIds.set(s.code, subjectId);

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
      classIdOf.set(`${s.code}:${c.kind}`, classId);
      await db
        .update(classes)
        .set({
          assessment: c.assessment,
          assessmentNote: c.assessmentNote,
          platformUrl: c.platformUrl,
        })
        .where(sql`${classes.id} = ${classId}`);
      for (const g of c.groups) {
        const groupId = await ensureGroup(db, classId, g);
        groupIds.set(`${c.kind}:${g}`, groupId);
        groupIdOf.set(`${s.code}:${c.kind}:${g}`, groupId);
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
        const groupId = slot.group
          ? (groupIds.get(`${c.kind}:${slot.group}`) as number)
          : null;
        const lecturerKey =
          (slot.group && c.groupLecturers?.[slot.group]) || c.lecturer;
        const uid = `seed-${s.code}-${c.kind}-${slot.group ?? 0}`;
        for (let week = -1; week <= 4; week++) {
          const start = at(week, slot.day, slot.start);
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
      const createdAt = new Date(Date.now() - t.daysAgo * DAY_MS);
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
      topicIdOf.set(t.title, topicId);
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

  // Discord forums of the previous data, back on the subject of the same code.
  for (const l of links) {
    const [res] = await db
      .update(subjects)
      .set({ discordChannelId: l.channelId })
      .where(eq(subjects.code, l.code));
    (res.affectedRows > 0 ? kept.relinked : kept.dropped).push(l.code);
  }
  if (kept.relinked.length) {
    log(`re-linked Discord forums: ${kept.relinked.join(', ')}`);
  }
  if (kept.dropped.length) {
    log(
      `dropped forum links of unknown subject codes: ${kept.dropped.join(', ')}`,
    );
  }

  // Imported exams: no class, their own feed.
  for (const x of EXAMS) {
    const start = at(x.week, x.day, x.start);
    const name = SUBJECTS.find((s) => s.code === x.code)?.name ?? x.code;
    sessionRows.push({
      uid: `seed-exam-${x.code}`,
      occurrenceStart: start,
      subjectId: subjectIds.get(x.code) as number,
      classId: null,
      groupId: null,
      lecturerId: lecturerIds.get(x.lecturer) as number,
      label: `Egzamin — ${name}`,
      room: x.room,
      startsAt: start,
      endsAt: new Date(start.getTime() + x.minutes * 60_000),
      kind: 'exam',
      source: 'exams',
    });
  }
  // Before the marks: a skip needs a session on its date.
  await db.insert(classSessions).values(sessionRows);

  const sub = (code: string) => subjectIds.get(code) as number;
  const cls = (key: string) => classIdOf.get(key) as number;
  const grp = (key: string) => groupIdOf.get(key) as number;
  const day = (w: number, d: number) => addDays(monday, w * 7 + d - 1);

  // ---- events (at most 3 adds per user: the hourly add limit is 10)
  const ev = async (
    what: string,
    by: number,
    input: Parameters<typeof addEvent>[2],
  ) => must(what, await addEvent(db, by, input, 'web')).id;

  // A Test inside next week's ASD lab (group 1): a Test badge on the session.
  const labTest = await ev('lab test', u1, {
    kind: 'kolokwium',
    title: 'Kolokwium z kopców',
    subjectId: sub('ASD'),
    classId: cls('ASD:laboratorium'),
    groupId: grp('ASD:laboratorium:1'),
    when: when(day(1, 2), '10:15', '11:00'),
    place: 'C-2 015',
    note: 'Implementacja kopca na kartce, 45 min.',
  });
  // A Test on a 90-min BD lab that also has the entry quiz: one merged bar.
  await ev('merged test', u2, {
    kind: 'kolokwium',
    title: 'Kolokwium SQL 1',
    subjectId: sub('BD'),
    classId: cls('BD:laboratorium'),
    groupId: grp('BD:laboratorium:1'),
    when: when(day(1, 4), '08:00', '09:30'),
    place: 'C-2 112',
  });
  // A Test matching no session (no class): a normal block.
  await ev('unmatched test', u3, {
    kind: 'kolokwium',
    title: 'Kolokwium z adresacji IP',
    subjectId: sub('SK'),
    when: when(day(1, 3), '18:00', '19:00'),
    place: 'D-3 112',
  });
  // Past: a Test on last week's AM2 exercises (group 3).
  await ev('past test', u4, {
    kind: 'kolokwium',
    title: 'Kolokwium 1 z AM2',
    subjectId: sub('AM2'),
    classId: cls('AM2:cwiczenia'),
    groupId: grp('AM2:cwiczenia:3'),
    when: when(day(-1, 1), '14:15', '15:30'),
    place: 'A-0 205',
  });
  // Within 60 min of the imported ASD exam: shown once, as the exam.
  const asdExam = EXAMS[0];
  await ev('exam event', u5, {
    kind: 'egzamin',
    title: 'Egzamin z ASD',
    subjectId: sub('ASD'),
    when: when(day(asdExam.week, asdExam.day), '10:30', '12:00'),
    place: asdExam.room,
  });
  await ev('oral exam', u1, {
    kind: 'egzamin',
    title: 'Egzamin ustny B2',
    subjectId: sub('JA'),
    when: when(addDays(today, 20), '09:00', '10:30'),
    place: 'S-1 08',
  });
  // No subject: posted to #wydarzenia. Edited afterwards by someone else.
  const trip = await ev('trip', adminId, {
    kind: 'wyjazd',
    title: 'Wyjazd integracyjny',
    subjectId: null,
    when: when(addDays(today, 10)),
    place: 'Zakopane',
  });
  must(
    'edit trip',
    await editEvent(
      db,
      u2,
      trip,
      {
        place: 'Zakopane, Dolina Kościeliska',
        note: 'Zbiórka 7:00 pod akademikiem. Zabierzcie legitymacje.',
      },
      'web',
    ),
  );
  const extra = await ev('extra class', u2, {
    kind: 'zajecia_dodatkowe',
    title: 'Zajęcia odrabiane — wątki',
    subjectId: sub('SO'),
    classId: cls('SO:laboratorium'),
    when: when(addDays(today, 5), '16:00', '17:30'),
    place: 'D-3 010',
  });
  await ev('project deadline', u3, {
    kind: 'inne',
    title: 'Oddanie projektu bazy danych',
    subjectId: sub('BD'),
    when: when(addDays(today, 18)),
    note: 'Skrypt DDL, diagram ERD i krótki raport w PDF.',
  });
  // Past, no subject.
  await ev('past meeting', u4, {
    kind: 'inne',
    title: 'Spotkanie z opiekunem roku',
    subjectId: null,
    when: when(addDays(today, -3), '12:00', '13:00'),
    place: 'A-0 001',
  });
  // Soft-deleted: an admin can restore it.
  const cancelled = await ev('deleted test', u5, {
    kind: 'kolokwium',
    title: 'Kolokwium poprawkowe z SO',
    subjectId: sub('SO'),
    when: when(addDays(today, 12), '10:00', '11:00'),
  });
  must('delete', await deleteEvent(db, u5, cancelled, 'web'));
  // A linked post: its files show on the event page.
  const lab1 = topicIdOf.get('Lab 1 — kopiec binarny') as number;
  must('link', await linkTopic(db, u1, labTest, lab1, 'web'));

  must(
    'weekly series',
    await addSeries(
      db,
      adminId,
      {
        kind: 'zajecia_dodatkowe',
        title: 'Konsultacje z ASD',
        subjectId: sub('ASD'),
        when: when(addDays(today, 1), '16:00', '17:00'),
        place: 'B-1 301',
        rule: 'weekly',
        until: isoDay(addDays(today, 36)),
      },
      'web',
    ),
  );
  must(
    'biweekly series',
    await addSeries(
      db,
      adminId,
      {
        kind: 'inne',
        title: 'Spotkanie samorządu',
        subjectId: null,
        when: when(addDays(today, 2), '18:00', '19:00'),
        place: 'Klub studencki',
        rule: 'biweekly',
        until: isoDay(addDays(today, 70)),
      },
      'web',
    ),
  );

  // ---- entry quizzes
  const allGroups = must(
    'mark all groups',
    await addMark(
      db,
      u3,
      {
        classId: cls('BD:laboratorium'),
        groupId: null,
        kind: 'wejsciowka',
        note: 'Wejściówka z SQL, 10 min na początku zajęć',
      },
      'web',
    ),
  ).id;
  must(
    'mark one group',
    await addMark(
      db,
      u4,
      {
        classId: cls('SO:laboratorium'),
        groupId: grp('SO:laboratorium:1'),
        kind: 'wejsciowka',
      },
      'discord',
    ),
  );
  // "Not this week" on this week's BD lab (Thursday).
  must('skip', await skipDate(db, u3, allGroups, isoDay(day(0, 4)), 'web'));
  const removed = must(
    'mark to remove',
    await addMark(
      db,
      u5,
      {
        classId: cls('AM2:cwiczenia'),
        groupId: null,
        kind: 'wejsciowka',
        note: 'Krótka wejściówka z pochodnych',
      },
      'web',
    ),
  ).id;
  must('remove mark', await removeMark(db, u5, removed, {}, 'web'));

  // ---- My groups: seed-u1 picks some classes (not all); seed-u2 none.
  for (const key of [
    'ASD:laboratorium:1',
    'ASD:cwiczenia:1',
    'BD:laboratorium:1',
  ]) {
    const classKey = key.slice(0, key.lastIndexOf(':'));
    const r = await setMyGroup(db, u1, cls(classKey), grp(key));
    if (!r.ok) throw new Error(`seed: my group ${key}`);
  }
  await setReminderPrefs(db, u1, { dayBefore: true, hourBefore: true }, 'web');

  // ---- admin SQL console: one executed and one rejected statement, written
  // the way apps/web/lib/admin-sql-handler.ts audits them.
  const executed =
    "UPDATE lecturers SET room = 'B-1 215' WHERE email = 'anna.nowak@example.edu'";
  const [upd] = (await db.execute(sql.raw(executed))) as unknown as [
    { affectedRows: number },
  ];
  await writeAudit(db, {
    userId: adminId,
    action: 'sql.execute',
    target: 'lecturers',
    statement: executed,
    rowsAffected: upd.affectedRows,
    details: { kind: 'update', previewAffected: upd.affectedRows },
  });
  await writeAudit(db, {
    userId: adminId,
    action: 'sql.rejected',
    statement: 'DROP TABLE materials',
    details: {
      mode: 'preview',
      reason:
        'Only SELECT, INSERT, UPDATE, DELETE and REPLACE statements are allowed.',
    },
  });

  // ---- one web upload for the extra class, as POST /api/wydarzenia/[id]/pliki
  // leaves it: the bot posts the file to the event's thread.
  const uploadName = 'zadania-watki.txt';
  const uploadBytes = Buffer.from(
    'Zadania na zajęcia odrabiane:\n1. Dwa wątki zwiększają wspólny licznik — dodaj mutex.\n2. Producent-konsument na zmiennej warunkowej.\n',
    'utf8',
  );
  const uploadRel = `uploads/${randomUUID()}`;
  mkdirSync(join(storageDir, 'uploads'), { recursive: true });
  writeFileSync(resolveInStorage(storageDir, uploadRel), uploadBytes, {
    mode: 0o600,
  });
  await db.transaction(async (tx) => {
    const [res] = await tx.insert(webUploads).values({
      eventId: extra,
      userId: u2,
      storagePath: uploadRel,
      originalFilename: uploadName,
      sizeBytes: uploadBytes.length,
    });
    await writeAudit(tx, {
      userId: u2,
      action: 'event.upload',
      target: String(extra),
      rowsAffected: 1,
      details: { source: 'web', count: 1, files: [uploadName] },
    });
    await enqueueBotRequest(tx, 'event_upload', `upload:${res.insertId}`, {
      eventId: extra,
      uploadIds: [res.insertId],
    });
  });

  const countOf = async (
    table: typeof events | typeof eventSeries | typeof botRequests,
  ) => {
    const [{ n: c }] = await db.select({ n: count() }).from(table);
    return Number(c);
  };
  const [{ n: liveMarks }] = await db
    .select({ n: count() })
    .from(classMarks)
    .where(isNull(classMarks.deletedAt));

  return {
    subjects: SUBJECTS.length,
    lecturers: LECTURERS.length,
    users: userIds.length + 2,
    files: fileCount,
    sessions: sessionRows.length,
    exams: EXAMS.length,
    events: await countOf(events),
    series: await countOf(eventSeries),
    marks: Number(liveMarks),
    botRequests: await countOf(botRequests),
    loginUsers: { student: u1, admin: adminId },
    kept,
  };
}
