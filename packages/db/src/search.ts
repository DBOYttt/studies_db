import { sql } from 'drizzle-orm';
import type { Db } from './client.js';

export type SearchHit = {
  materialId: number | null;
  topicId: number;
  topicTitle: string;
  subjectCode: string;
  subjectName: string;
  filename: string | null;
  snippet: string;
  score: number;
};

const DEFAULT_LIMIT = 20;

function sanitizeQuery(q: string): string {
  return q
    .replace(/[+\-<>()~*"@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMarks(s: string): string {
  // ł/Ł have no Unicode decomposition, so map them explicitly.
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L');
}

// Normalise char-by-char so indices stay aligned with the original text
function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of text) {
    const f = stripMarks(ch).toLowerCase();
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
    i += ch.length;
  }
  return { folded, map };
}

export function buildSnippet(text: string, q: string, radius = 120): string {
  const words = stripMarks(sanitizeQuery(q).toLowerCase())
    .split(' ')
    .filter(Boolean);
  const { folded, map } = foldWithMap(text);
  for (const w of words) {
    const idx = folded.indexOf(stripMarks(w));
    if (idx < 0) continue;
    const start = map[idx];
    const lastFolded = idx + stripMarks(w).length - 1;
    const lastStart = map[lastFolded];
    const end =
      lastStart + String.fromCodePoint(text.codePointAt(lastStart) ?? 0).length;
    const from = Math.max(0, start - radius);
    const to = Math.min(text.length, end + radius);
    return (
      (from > 0 ? '…' : '') +
      text.slice(from, start) +
      '«' +
      text.slice(start, end) +
      '»' +
      text.slice(end, to) +
      (to < text.length ? '…' : '')
    );
  }
  return text.length > 2 * radius ? `${text.slice(0, 2 * radius)}…` : text;
}

type Row = {
  material_id: number | null;
  topic_id: number;
  topic_title: string;
  subject_code: string;
  subject_name: string;
  filename: string | null;
  body: string | null;
  score: number | string;
};

export async function searchAll(
  db: Db,
  opts: { q: string; subjectId?: number; tagId?: number; limit?: number },
): Promise<SearchHit[]> {
  const q = sanitizeQuery(opts.q);
  if (!q) return [];
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const subj = opts.subjectId
    ? sql`AND t.subject_id = ${opts.subjectId}`
    : sql``;
  const tag = opts.tagId
    ? sql`AND EXISTS (SELECT 1 FROM topic_tags tt WHERE tt.topic_id = t.id AND tt.tag_id = ${opts.tagId})`
    : sql``;

  const res = await db.execute(sql`
    SELECT * FROM (
      SELECT m.id AS material_id, t.id AS topic_id, t.title AS topic_title,
             s.code AS subject_code, s.name AS subject_name,
             m.original_filename AS filename,
             COALESCE(m.extracted_text, m.original_filename) AS body,
             MATCH(m.original_filename, m.extracted_text)
               AGAINST (${q} IN NATURAL LANGUAGE MODE) AS score
      FROM materials m
      JOIN topics t ON t.id = m.topic_id
      JOIN subjects s ON s.id = t.subject_id
      WHERE m.deleted_at IS NULL AND t.deleted_at IS NULL
        AND MATCH(m.original_filename, m.extracted_text)
            AGAINST (${q} IN NATURAL LANGUAGE MODE)
        ${subj} ${tag}
      UNION ALL
      SELECT NULL, t.id, t.title, s.code, s.name, NULL, t.title,
             MATCH(t.title) AGAINST (${q} IN NATURAL LANGUAGE MODE)
      FROM topics t
      JOIN subjects s ON s.id = t.subject_id
      WHERE t.deleted_at IS NULL
        AND MATCH(t.title) AGAINST (${q} IN NATURAL LANGUAGE MODE)
        ${subj} ${tag}
    ) hits
    ORDER BY score DESC
    LIMIT ${limit}
  `);
  const rows = res[0] as unknown as Row[];
  return rows.map((r) => ({
    materialId: r.material_id,
    topicId: r.topic_id,
    topicTitle: r.topic_title,
    subjectCode: r.subject_code,
    subjectName: r.subject_name,
    filename: r.filename,
    snippet: buildSnippet(r.body ?? '', q),
    score: Number(r.score),
  }));
}
