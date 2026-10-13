/**
 * Admin SQL write console: statement checks, preview SELECTs and preview
 * confirmation tokens. Pure (no DB, no Next imports).
 *
 * This is the second security layer; the hard boundary is the MariaDB grants
 * of `studies_rw`. Every check here fails closed: anything the tokenizer is
 * unsure about is rejected rather than guessed.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { BUSY_ERROR, EMPTY_QUERY_ERROR, timeoutMessage } from './sql-messages';

export type StatementKind =
  | 'select'
  | 'insert'
  | 'update'
  | 'delete'
  | 'replace';

export type Classification =
  | { ok: true; kind: StatementKind; table: string | null }
  | { ok: false; reason: string };

export const PREVIEW_ROWS = 50;
export const SELECT_ROWS = 500;
export const TOKEN_TTL_MS = 300_000;
export const CONFIRM_THRESHOLD = 100;
/** MAX_STATEMENT_TIME of `studies_rw`, in seconds. */
const STATEMENT_TIMEOUT_SEC = 5;

export const PERMISSION_ERROR =
  'Brak uprawnień: ta tabela jest poza zakresem konsoli administratora.';

// ---------------------------------------------------------------- tokenizer

type TokType = 'word' | 'bq' | 'str' | 'punct' | 'comment';
interface Tok {
  t: TokType;
  /** Source range [s, e). */
  s: number;
  e: number;
  v: string;
}

type LexResult = { ok: true; toks: Tok[] } | { ok: false; reason: string };

const isWordChar = (c: number) =>
  (c >= 48 && c <= 57) || // 0-9
  (c >= 65 && c <= 90) || // A-Z
  (c >= 97 && c <= 122) || // a-z
  c === 95 || // _
  c === 36 || // $
  c >= 0x80; // MariaDB treats non-ASCII as identifier characters

/**
 * Splits `sql` into tokens the way the MariaDB lexer delimits them.
 * `backslash` = whether `\` escapes inside '…' / "…" (off under
 * NO_BACKSLASH_ESCAPES); backticks never use backslash escapes.
 */
function lex(sql: string, backslash: boolean): LexResult {
  const toks: Tok[] = [];
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql.charCodeAt(i);
    const ch = sql[i];
    if (c === 0) return { ok: false, reason: 'Zapytanie zawiera bajt NUL.' };
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (c < 0x20 || c === 0x7f) {
      return { ok: false, reason: 'Zapytanie zawiera znak sterujący.' };
    }
    const next = sql[i + 1];
    // Line comments: `#…` always; `--` only when followed by whitespace,
    // a control character or the end (`1--1` is arithmetic in MariaDB).
    if (
      ch === '#' ||
      (ch === '-' &&
        next === '-' &&
        (i + 2 >= n || sql.charCodeAt(i + 2) <= 0x20))
    ) {
      let j = sql.indexOf('\n', i);
      if (j < 0) j = n;
      toks.push({ t: 'comment', s: i, e: j, v: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      const a = sql[i + 2];
      const b = sql[i + 3];
      if (a === '!' || ((a === 'M' || a === 'm') && b === '!')) {
        return {
          ok: false,
          reason: 'Komentarze wykonywalne (/*! … */) są niedozwolone.',
        };
      }
      const j = sql.indexOf('*/', i + 2);
      if (j < 0)
        return { ok: false, reason: 'Niezamknięty komentarz /* … */.' };
      toks.push({ t: 'comment', s: i, e: j + 2, v: sql.slice(i, j + 2) });
      i = j + 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      const q = ch;
      const escapes = backslash && q !== '`';
      let j = i + 1;
      let closed = false;
      while (j < n) {
        const d = sql[j];
        if (escapes && d === '\\') {
          j += 2;
          continue;
        }
        if (d === q) {
          if (sql[j + 1] === q) {
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (!closed || j > n) {
        return { ok: false, reason: `Niezamknięty cudzysłów ${q}.` };
      }
      toks.push({
        t: q === '`' ? 'bq' : 'str',
        s: i,
        e: j,
        v: sql
          .slice(i + 1, j - 1)
          .split(q + q)
          .join(q),
      });
      i = j;
      continue;
    }
    if (isWordChar(c)) {
      let j = i + 1;
      while (j < n && isWordChar(sql.charCodeAt(j))) j++;
      toks.push({ t: 'word', s: i, e: j, v: sql.slice(i, j) });
      i = j;
      continue;
    }
    toks.push({ t: 'punct', s: i, e: i + 1, v: ch });
    i++;
  }
  return { ok: true, toks };
}

/**
 * Lexes under both backslash modes and requires identical token boundaries,
 * so the result does not depend on the server's NO_BACKSLASH_ESCAPES setting.
 */
function lexStrict(sql: string): LexResult {
  const a = lex(sql, true);
  if (!a.ok) return a;
  const b = lex(sql, false);
  if (!b.ok) return b;
  const same =
    a.toks.length === b.toks.length &&
    a.toks.every((t, k) => {
      const u = b.toks[k];
      return t.t === u.t && t.s === u.s && t.e === u.e;
    });
  if (!same) {
    return {
      ok: false,
      reason:
        "Niejednoznaczny ukośnik wsteczny przed cudzysłowem — użyj podwójnego apostrofu ('').",
    };
  }
  return a;
}

// ------------------------------------------------------------ classification

const KINDS: Record<string, StatementKind> = {
  SELECT: 'select',
  INSERT: 'insert',
  UPDATE: 'update',
  DELETE: 'delete',
  REPLACE: 'replace',
};

/** Rejected wherever they appear as a bare word outside literals/comments. */
const FORBIDDEN_WORDS = new Set([
  'OUTFILE',
  'DUMPFILE',
  'LOAD_FILE',
  'LOAD', // LOAD DATA / LOAD XML
  'CALL',
  'LOCK',
  'HANDLER',
  'DO',
  'PROCEDURE',
]);

/** Rejected when called, i.e. a name (bare or quoted) followed by `(`. */
const FORBIDDEN_FUNCS = new Set([
  'SLEEP',
  'BENCHMARK',
  'LOAD_FILE',
  'GET_LOCK',
  'RELEASE_LOCK',
  'RELEASE_ALL_LOCKS',
  'MASTER_POS_WAIT',
  'MASTER_GTID_WAIT',
  'SYS_EXEC',
  'SYS_EVAL',
]);

const MODIFIERS: Record<StatementKind, string[]> = {
  select: [],
  insert: ['LOW_PRIORITY', 'DELAYED', 'HIGH_PRIORITY', 'IGNORE'],
  replace: ['LOW_PRIORITY', 'DELAYED'],
  update: ['LOW_PRIORITY', 'IGNORE'],
  delete: ['LOW_PRIORITY', 'QUICK', 'IGNORE'],
};

const up = (t: Tok | undefined) => (t?.t === 'word' ? t.v.toUpperCase() : '');
const isPunct = (t: Tok | undefined, p: string) =>
  t?.t === 'punct' && t.v === p;
const isAscii = (s: string) => /^[\x20-\x7e]*$/.test(s);

/** Unqualified table name from an identifier token, else null. */
function tableName(code: Tok[], k: number): string | null {
  const t = code[k];
  if (!t || isPunct(code[k + 1], '.')) return null;
  if (t.t === 'bq') return t.v === '' ? null : t.v;
  if (t.t === 'word' && /^[A-Za-z0-9_$]+$/.test(t.v) && !/^\d+$/.test(t.v)) {
    return t.v;
  }
  return null;
}

type Analysis =
  | {
      ok: true;
      kind: StatementKind;
      table: string | null;
      code: Tok[];
      toks: Tok[];
    }
  | { ok: false; reason: string };

function analyze(sql: string): Analysis {
  const lexed = lexStrict(sql);
  if (!lexed.ok) return lexed;
  const toks = lexed.toks;
  let code = toks.filter((t) => t.t !== 'comment');
  if (code.length === 0) return { ok: false, reason: EMPTY_QUERY_ERROR };

  // Exactly one statement: a `;` may only be the last code token.
  const semi = code.findIndex((t) => isPunct(t, ';'));
  if (semi >= 0) {
    if (semi !== code.length - 1) {
      return { ok: false, reason: 'Dozwolone jest tylko jedno polecenie.' };
    }
    code = code.slice(0, semi);
    if (code.length === 0) return { ok: false, reason: EMPTY_QUERY_ERROR };
  }

  const kind = KINDS[up(code[0])];
  if (!kind) {
    return {
      ok: false,
      reason:
        'Dozwolone są tylko polecenia SELECT, INSERT, UPDATE, DELETE i REPLACE.',
    };
  }

  // Target table (single-table forms only) and the position of INSERT/REPLACE … INTO.
  let k = 1;
  while (MODIFIERS[kind].includes(up(code[k]))) k++;
  let intoAt = -1;
  let table: string | null = null;
  if (kind === 'insert' || kind === 'replace') {
    if (up(code[k]) === 'INTO') intoAt = k++;
    const after = code[k + 1];
    if (
      !after ||
      isPunct(after, '(') ||
      ['VALUES', 'VALUE', 'SET', 'SELECT'].includes(up(after))
    ) {
      table = tableName(code, k);
    }
  } else if (kind === 'update') {
    if (up(code[k + 1]) === 'SET') table = tableName(code, k);
  } else if (kind === 'delete') {
    if (up(code[k]) === 'FROM') {
      const after = code[k + 2];
      if (
        !after ||
        ['WHERE', 'ORDER', 'LIMIT', 'RETURNING'].includes(up(after))
      ) {
        table = tableName(code, k + 1);
      }
    }
  }

  for (let i = 0; i < code.length; i++) {
    const t = code[i];
    if (t.t === 'word') {
      if (!isAscii(t.v)) {
        return {
          ok: false,
          reason: `Niedozwolone znaki spoza ASCII poza literałem: ${t.v}`,
        };
      }
      const w = t.v.toUpperCase();
      if (FORBIDDEN_WORDS.has(w)) {
        return { ok: false, reason: `Niedozwolone słowo kluczowe: ${w}` };
      }
      if (
        w === 'SET' &&
        kind !== 'update' &&
        kind !== 'insert' &&
        kind !== 'replace'
      ) {
        return { ok: false, reason: 'Niedozwolone słowo kluczowe: SET' };
      }
      if (w === 'INTO' && i !== intoAt) {
        return { ok: false, reason: 'Niedozwolone słowo kluczowe: INTO' };
      }
    }
    if (
      (t.t === 'word' || t.t === 'bq' || t.t === 'str') &&
      isPunct(code[i + 1], '(')
    ) {
      if (!isAscii(t.v)) {
        return {
          ok: false,
          reason: `Niedozwolona nazwa funkcji spoza ASCII: ${t.v}`,
        };
      }
      const f = t.v.toUpperCase();
      if (FORBIDDEN_FUNCS.has(f)) {
        return { ok: false, reason: `Niedozwolona funkcja: ${f}()` };
      }
    }
  }

  return { ok: true, kind, table, code, toks };
}

export function classifyStatement(sql: string): Classification {
  const a = analyze(sql);
  if (!a.ok) return a;
  return { ok: true, kind: a.kind, table: a.table };
}

const quoteIdent = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    ? name
    : `\`${name.replace(/`/g, '``')}\``;

/**
 * For single-table UPDATE/DELETE with a WHERE clause:
 * `SELECT * FROM <table> WHERE <where> LIMIT 50` (WHERE up to a top-level
 * ORDER BY / LIMIT / RETURNING, comments dropped); otherwise null.
 */
export function previewSelect(
  sql: string,
  kind: StatementKind,
  table: string | null,
): string | null {
  if ((kind !== 'update' && kind !== 'delete') || !table) return null;
  const a = analyze(sql);
  if (!a.ok || a.kind !== kind || a.table !== table) return null;
  const code = a.code;

  let depth = 0;
  let where = -1;
  let end = code.length;
  for (let i = 0; i < code.length; i++) {
    const t = code[i];
    if (isPunct(t, '(')) depth++;
    else if (isPunct(t, ')')) depth--;
    if (depth !== 0) continue;
    const w = up(t);
    if (where < 0) {
      if (w === 'WHERE') where = i;
    } else if (
      (w === 'ORDER' && up(code[i + 1]) === 'BY') ||
      w === 'LIMIT' ||
      w === 'RETURNING'
    ) {
      end = i;
      break;
    }
  }
  if (where < 0 || end <= where + 1) return null;

  const from = code[where + 1].s;
  const to = code[end - 1].e;
  let text = '';
  let pos = from;
  for (const c of a.toks) {
    if (c.t !== 'comment' || c.s < from || c.e > to) continue;
    text += `${sql.slice(pos, c.s)} `;
    pos = c.e;
  }
  text += sql.slice(pos, to);

  const out = `SELECT * FROM ${quoteIdent(table)} WHERE ${text.trim()} LIMIT ${PREVIEW_ROWS}`;
  const check = classifyStatement(out);
  return check.ok && check.kind === 'select' ? out : null;
}

// ------------------------------------------------------------------ tokens

declare global {
  // eslint-disable-next-line no-var
  var __studiesAdminSqlKey: Buffer | undefined;
}

function key(): Buffer {
  globalThis.__studiesAdminSqlKey ??= randomBytes(32);
  return globalThis.__studiesAdminSqlKey;
}

const mac = (userId: number, at: number, affected: number, sql: string) =>
  createHmac('sha256', key())
    .update(`${userId}|${at}|${affected}|${sql}`)
    .digest('hex');

const isCount = (n: number) => Number.isSafeInteger(n) && n >= 0;

export function signPreview(p: {
  userId: number;
  sql: string;
  affected: number;
  at: number;
}): string {
  if (!isCount(p.userId) || !isCount(p.at) || !isCount(p.affected)) {
    throw new Error('signPreview: invalid numeric field');
  }
  const body = `${p.userId}.${p.at}.${p.affected}.${mac(p.userId, p.at, p.affected, p.sql)}`;
  return Buffer.from(body).toString('base64url');
}

const INVALID_TOKEN =
  'Nieprawidłowy token potwierdzenia lub zapytanie zmieniło się od podglądu. Wykonaj podgląd ponownie.';
const EXPIRED_TOKEN = 'Token potwierdzenia wygasł. Wykonaj podgląd ponownie.';

export function verifyPreview(
  token: string,
  p: { userId: number; sql: string; now: number },
): { ok: true; affected: number } | { ok: false; reason: string } {
  const invalid = { ok: false as const, reason: INVALID_TOKEN };
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(token)) {
    return invalid;
  }
  const m = /^(\d{1,16})\.(\d{1,16})\.(\d{1,16})\.([0-9a-f]{64})$/.exec(
    Buffer.from(token, 'base64url').toString(),
  );
  if (!m) return invalid;
  const userId = Number(m[1]);
  const at = Number(m[2]);
  const affected = Number(m[3]);
  if (!isCount(userId) || !isCount(at) || !isCount(affected)) return invalid;
  const expected = Buffer.from(mac(userId, at, affected, p.sql), 'hex');
  const given = Buffer.from(m[4], 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return invalid;
  }
  if (userId !== p.userId) return invalid;
  if (p.now < at || p.now - at > TOKEN_TTL_MS) {
    return { ok: false, reason: EXPIRED_TOKEN };
  }
  return { ok: true, affected };
}

// ------------------------------------------------------------------ errors

const PERMISSION_ERRNOS = new Set([1142, 1143, 1044]);

/** DB error from the RW console -> user message (MariaDB text verbatim otherwise). */
export function adminSqlErrorMessage(err: unknown): string {
  const e = err as { errno?: unknown; message?: unknown } | null | undefined;
  const errno = typeof e?.errno === 'number' ? e.errno : undefined;
  if (errno !== undefined && PERMISSION_ERRNOS.has(errno))
    return PERMISSION_ERROR;
  if (errno === 1226) return BUSY_ERROR;
  if (errno === 1969 || errno === 1317)
    return timeoutMessage(STATEMENT_TIMEOUT_SEC);
  if (typeof e?.message === 'string' && e.message !== '') return e.message;
  return 'Nieznany błąd bazy danych.';
}
