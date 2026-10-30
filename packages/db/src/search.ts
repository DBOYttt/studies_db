import { sql } from 'drizzle-orm';
import type { DbExecutor } from './client.js';
import { foldStroke } from './text.js';

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
const MAX_LIMIT = 100;

export function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

function sanitizeQuery(q: string): string {
  return q
    .replace(/[+\-<>()~*"@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripMarks(s: string): string {
  // ł/Ł have no Unicode decomposition, so map them explicitly.
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'L');
}

// Map each folded letter to every Latin variant that folds to it, so the
// original text can be searched with one native regex (no per-char folding).
let variants: Map<string, string> | null = null;
function variantClass(c: string): string {
  if (!variants) {
    const groups = new Map<string, string>();
    for (let cp = 0x20; cp <= 0x24f; cp++) {
      const ch = String.fromCodePoint(cp);
      const f = stripMarks(ch).toLowerCase();
      if (f.length === 1) {
        groups.set(f, (groups.get(f) ?? '') + ch + ch.toLowerCase());
      }
    }
    variants = groups;
  }
  const extra = variants.get(c);
  const esc = c.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return extra ? `[${extra.replace(/[\]\\^-]/g, '\\$&')}]` : esc;
}

function wordRegex(word: string): RegExp {
  const src = [...word].map((c) => `${variantClass(c)}\\p{M}*`).join('');
  return new RegExp(src, 'iu');
}

export function buildSnippet(text: string, q: string, radius = 120): string {
  const words = stripMarks(sanitizeQuery(q).toLowerCase())
    .split(' ')
    .filter(Boolean);
  for (const w of words) {
    const m = wordRegex(w).exec(text);
    if (!m) continue;
    const start = m.index;
    const end = start + m[0].length;
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
  db: DbExecutor,
  opts: { q: string; subjectId?: number; tagId?: number; limit?: number },
): Promise<SearchHit[]> {
  const q = sanitizeQuery(opts.q);
  if (!q) return [];
  const firstWord = q.split(' ')[0];
  // search_name and search_text have ł folded (the collation handles the
  // other diacritics), so the materials query is folded the same way.
  const fq = foldStroke(q);
  const limit = clampLimit(opts.limit);
  const subj = opts.subjectId
    ? sql`AND t.subject_id = ${opts.subjectId}`
    : sql``;
  const tag = opts.tagId
    ? sql`AND EXISTS (SELECT 1 FROM topic_tags tt WHERE tt.topic_id = t.id AND tt.tag_id = ${opts.tagId})`
    : sql``;

  // Rank and LIMIT first; only the kept material hits then read their
  // MEDIUMTEXT columns for the snippet (topic hits use the title).
  // Equal scores are ordered material hits first, then by id: without the
  // MEDIUMTEXT body in the sorted rows the server's own tie order is not
  // stable, and the outer sort has to repeat the inner one.
  const res = await db.execute(sql`
    SELECT h.material_id, h.topic_id, h.topic_title, h.subject_code,
           h.subject_name, h.filename,
           CASE WHEN h.material_id IS NULL THEN h.topic_title
             ELSE SUBSTRING(COALESCE(bm.extracted_text, bm.original_filename),
               GREATEST(1, LOCATE(${foldStroke(firstWord)}, COALESCE(bm.search_text, bm.original_filename)) - 300),
               1000)
           END AS body,
           h.score
    FROM (
      SELECT * FROM (
        SELECT m.id AS material_id, t.id AS topic_id, t.title AS topic_title,
               s.code AS subject_code, s.name AS subject_name,
               m.original_filename AS filename,
               MATCH(m.search_name, m.search_text)
                 AGAINST (${fq} IN NATURAL LANGUAGE MODE) AS score
        FROM materials m
        JOIN topics t ON t.id = m.topic_id
        JOIN subjects s ON s.id = t.subject_id
        WHERE m.deleted_at IS NULL AND t.deleted_at IS NULL
          AND MATCH(m.search_name, m.search_text)
              AGAINST (${fq} IN NATURAL LANGUAGE MODE)
          ${subj} ${tag}
        UNION ALL
        SELECT NULL, t.id, t.title, s.code, s.name, NULL,
               MATCH(t.title) AGAINST (${q} IN NATURAL LANGUAGE MODE)
        FROM topics t
        JOIN subjects s ON s.id = t.subject_id
        WHERE t.deleted_at IS NULL
          AND MATCH(t.title) AGAINST (${q} IN NATURAL LANGUAGE MODE)
          ${subj} ${tag}
      ) hits
      ORDER BY score DESC, material_id IS NULL, material_id, topic_id
      LIMIT ${limit}
    ) h
    LEFT JOIN materials bm ON bm.id = h.material_id
    ORDER BY h.score DESC, h.material_id IS NULL, h.material_id, h.topic_id
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
