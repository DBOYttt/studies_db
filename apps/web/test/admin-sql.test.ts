import { describe, expect, it } from 'vitest';
import {
  adminSqlErrorMessage,
  CONFIRM_THRESHOLD,
  classifyStatement,
  PREVIEW_ROWS,
  previewSelect,
  SELECT_ROWS,
  signPreview,
  TOKEN_TTL_MS,
  verifyPreview,
} from '../lib/admin-sql';
import { BUSY_ERROR, timeoutMessage } from '../lib/sql-messages';

describe('constants', () => {
  it('match the spec limits', () => {
    expect(PREVIEW_ROWS).toBe(50);
    expect(SELECT_ROWS).toBe(500);
    expect(TOKEN_TTL_MS).toBe(300_000);
    expect(CONFIRM_THRESHOLD).toBe(100);
  });
});

describe('classifyStatement — allowed', () => {
  it.each([
    ['UPDATE subjects SET ects = 5 WHERE id = 1', 'update', 'subjects'],
    ['delete from `tags` where id=3;', 'delete', 'tags'],
    ["INSERT INTO lecturers (name) VALUES ('X')", 'insert', 'lecturers'],
    ["REPLACE INTO tags (id, name) VALUES (1, 'a')", 'replace', 'tags'],
    ['SELECT * FROM v_subjects', 'select', null],
    ["-- c\nUPDATE topics SET title='a' WHERE id=1", 'update', 'topics'],
    [
      "UPDATE subjects SET description = 'INTO OUTFILE; SLEEP(5)' WHERE id=1",
      'update',
      'subjects',
    ],
    [
      'UPDATE subjects s JOIN classes c ON c.subject_id = s.id SET s.ects = 5 WHERE c.id = 1',
      'update',
      null,
    ],
    // extra: comments, quoting, trailing semicolon
    ['# c\nSELECT 1', 'select', null],
    ['/* c */ DELETE FROM tags WHERE id = 1; -- done', 'delete', 'tags'],
    ['UPDATE subjects SET ects = 5 WHERE id = 1 ;  \n', 'update', 'subjects'],
    ["UPDATE tags SET name = 'O''Brien' WHERE id = 1", 'update', 'tags'],
    ['UPDATE tags SET name = "a ; DROP" WHERE id = 1', 'update', 'tags'],
    ["UPDATE tags SET name = 'C:\\\\path' WHERE id = 1", 'update', 'tags'],
    [
      'insert ignore into `topic_tags` (topic_id, tag_id) VALUES (1, 2)',
      'insert',
      'topic_tags',
    ],
    ['INSERT tags SET name = 1', 'insert', 'tags'],
    ['DELETE FROM tags', 'delete', 'tags'],
    ['DELETE FROM tags USING tags JOIN topics', 'delete', null],
    ['UPDATE subjects, classes SET ects = 1', 'update', null],
    ['UPDATE subjects s SET s.ects = 1 WHERE s.id = 1', 'update', null],
    ['SELECT 1 - -1', 'select', null],
    ['SELECT sleep FROM t', 'select', null],
    ['SELECT `Średnia` FROM t', 'select', null],
    // number literals
    ['SELECT 1.5, 2e3 FROM v_subjects', 'select', null],
    ['UPDATE subjects SET ects = 1.5 WHERE id = 1', 'update', 'subjects'],
    ['SELECT .5, 1e-3, 1.e2, 0x1F, 0b101, 3 FROM v_subjects', 'select', null],
    ['SELECT 1e1x FROM v_subjects', 'select', null],
  ])('%s', (sql, kind, table) => {
    expect(classifyStatement(sql)).toEqual({ ok: true, kind, table });
  });
});

describe('classifyStatement — rejected', () => {
  it.each([
    '',
    '   -- only a comment',
    'DROP TABLE tags',
    'TRUNCATE tags',
    'CREATE TABLE x(a int)',
    'UPDATE a SET b=1; DELETE FROM c',
    '/*!50000 DROP TABLE tags */',
    "SELECT 1 INTO OUTFILE '/tmp/x'",
    "SELECT LOAD_FILE('/etc/passwd')",
    'SET GLOBAL x=1',
    'CALL p()',
    'LOCK TABLES t WRITE',
    'DO SLEEP(5)',
    'SELECT SLEEP(5)',
    'SELECT BENCHMARK(1,1)',
    // bypass attempts
    'SELECT 1 /*!50000 , SLEEP(5) */',
    'SELECT 1 /*M!100000 , SLEEP(5) */',
    'SELECT sleep (5)',
    'SELECT sleep/**/(5)',
    'SELECT `sleep`(5)',
    'SELECT "sleep"(5)',
    'SELECT sléép(5)',
    'SELECT Średnia FROM t',
    'SELECT 1 --SLEEP(5)',
    'SELECT 1 INTO DUMPFILE "/tmp/x"',
    'SELECT 1 INTO @x',
    "SELECT GET_LOCK('x', 1)",
    'SELECT 1 FROM t LOCK IN SHARE MODE',
    'UPDATE a SET b=1;;',
    'UPDATE a SET b=1; /* c */ SELECT 1',
    "SELECT 'a\\'; DROP TABLE x; --'",
    "SELECT 'unterminated",
    'SELECT `unterminated',
    'SELECT 1 /* unterminated',
    'SELECT 1\u0000',
    'SET STATEMENT max_statement_time=0 FOR UPDATE tags SET name=1',
    '(SELECT 1)',
    'WITH x AS (SELECT 1) SELECT * FROM x',
    'HANDLER tags OPEN',
    "LOAD DATA INFILE 'x' INTO TABLE tags",
    "SELECT 1 FROM t WHERE 1 AND LOAD_FILE('x')",
    'DELETE FROM tags WHERE id IN (SELECT 1 FROM t SET x)',
    'SELECT 1 PROCEDURE ANALYSE()',
    'ALTER TABLE tags ADD c INT',
    'GRANT ALL ON *.* TO x',
  ])('%j', (sql) => {
    const r = classifyStatement(sql);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/\S/);
  });
});

describe('classifyStatement — number literal glued to a keyword', () => {
  // MariaDB ends a decimal/float literal at the first character that cannot
  // continue it, so `1e1INTO` is `1e1` + `INTO` on the server.
  it.each([
    ['SELECT 1.5INTO @x', 'INTO'],
    ['SELECT 1e1INTO @x', 'INTO'],
    ['SELECT * FROM tags WHERE id=1e0INTO @x', 'INTO'],
    ['SELECT * FROM tags WHERE id=1.0PROCEDURE ANALYSE()', 'PROCEDURE'],
    ['SELECT * FROM tags WHERE id=1.0LOCK IN SHARE MODE', 'LOCK'],
    ['SELECT 1e+1INTO @x', 'INTO'],
    ['SELECT .5INTO @x', 'INTO'],
    ['SELECT 1.e1INTO @x', 'INTO'],
    ['SELECT 1E-1INTO @x', 'INTO'],
    ['SELECT 1.5SLEEP(5)', 'SLEEP'],
  ])('%s', (sql, word) => {
    const r = classifyStatement(sql);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(word);
  });
});

describe('previewSelect', () => {
  it('UPDATE with WHERE up to ORDER BY/LIMIT', () => {
    expect(
      previewSelect(
        'UPDATE subjects SET ects=5 WHERE semester = 1 ORDER BY id LIMIT 3',
        'update',
        'subjects',
      ),
    ).toBe('SELECT * FROM subjects WHERE semester = 1 LIMIT 50');
  });
  it('DELETE with WHERE → same shape', () => {
    expect(
      previewSelect(
        'DELETE FROM subjects WHERE semester = 1 ORDER BY id LIMIT 3',
        'delete',
        'subjects',
      ),
    ).toBe('SELECT * FROM subjects WHERE semester = 1 LIMIT 50');
    expect(
      previewSelect('DELETE FROM tags WHERE id = 3;', 'delete', 'tags'),
    ).toBe('SELECT * FROM tags WHERE id = 3 LIMIT 50');
  });
  it('drops comments inside and after the WHERE clause', () => {
    expect(
      previewSelect('DELETE FROM tags WHERE id = 1 -- x', 'delete', 'tags'),
    ).toBe('SELECT * FROM tags WHERE id = 1 LIMIT 50');
    expect(
      previewSelect(
        'DELETE FROM tags WHERE id /* c */ = 1 # x\n',
        'delete',
        'tags',
      ),
    ).toBe('SELECT * FROM tags WHERE id   = 1 LIMIT 50');
  });
  it('keeps nested ORDER BY / LIMIT inside subqueries', () => {
    expect(
      previewSelect(
        'UPDATE tags SET name = 1 WHERE id IN (SELECT id FROM topics ORDER BY id LIMIT 2) LIMIT 1',
        'update',
        'tags',
      ),
    ).toBe(
      'SELECT * FROM tags WHERE id IN (SELECT id FROM topics ORDER BY id LIMIT 2) LIMIT 50',
    );
  });
  it('uses the unquoted table name from a backtick identifier', () => {
    expect(
      previewSelect(
        'DELETE FROM `topic_tags` WHERE tag_id = 1',
        'delete',
        'topic_tags',
      ),
    ).toBe('SELECT * FROM topic_tags WHERE tag_id = 1 LIMIT 50');
  });
  it('no WHERE → null', () => {
    expect(
      previewSelect('UPDATE subjects SET ects = 5', 'update', 'subjects'),
    ).toBeNull();
    expect(
      previewSelect('DELETE FROM tags LIMIT 3', 'delete', 'tags'),
    ).toBeNull();
  });
  it('multi-table / null table → null', () => {
    expect(
      previewSelect(
        'UPDATE subjects s JOIN classes c ON c.subject_id = s.id SET s.ects = 5 WHERE c.id = 1',
        'update',
        null,
      ),
    ).toBeNull();
  });
  it('insert / replace / select → null', () => {
    expect(
      previewSelect(
        "INSERT INTO lecturers (name) VALUES ('X')",
        'insert',
        'lecturers',
      ),
    ).toBeNull();
    expect(
      previewSelect('REPLACE INTO tags SET id = 1', 'replace', 'tags'),
    ).toBeNull();
    expect(
      previewSelect('SELECT * FROM tags WHERE id = 1', 'select', null),
    ).toBeNull();
  });
  it('ends WHERE at ORDER BY / LIMIT glued to a number literal', () => {
    expect(
      previewSelect(
        'UPDATE tags SET name=1 WHERE id > 1e0ORDER BY id LIMIT 1',
        'update',
        'tags',
      ),
    ).toBe('SELECT * FROM tags WHERE id > 1e0 LIMIT 50');
    expect(
      previewSelect('DELETE FROM tags WHERE id=1.5LIMIT 1', 'delete', 'tags'),
    ).toBe('SELECT * FROM tags WHERE id=1.5 LIMIT 50');
  });
  it('rejected statement → null', () => {
    expect(
      previewSelect('DELETE FROM tags WHERE SLEEP(5)', 'delete', 'tags'),
    ).toBeNull();
  });
});

describe('preview tokens', () => {
  const sql = 'UPDATE subjects SET ects = 5 WHERE id = 1';
  const at = 1_700_000_000_000;

  it('round-trips with affected', () => {
    const t = signPreview({ userId: 7, sql, affected: 12, at });
    expect(verifyPreview(t, { userId: 7, sql, now: at })).toEqual({
      ok: true,
      affected: 12,
      mac: expect.stringMatching(/^[0-9a-f]{64}$/),
      issuedAt: at,
    });
    expect(
      verifyPreview(t, { userId: 7, sql, now: at + TOKEN_TTL_MS }),
    ).toMatchObject({ ok: true, affected: 12 });
  });
  it('expires after 5 min + 1 ms', () => {
    const t = signPreview({ userId: 7, sql, affected: 12, at });
    expect(
      verifyPreview(t, { userId: 7, sql, now: at + 5 * 60_000 + 1 }).ok,
    ).toBe(false);
  });
  it('rejects another user', () => {
    const t = signPreview({ userId: 7, sql, affected: 12, at });
    expect(verifyPreview(t, { userId: 8, sql, now: at }).ok).toBe(false);
  });
  it('rejects sql differing by one space', () => {
    const t = signPreview({ userId: 7, sql, affected: 12, at });
    expect(
      verifyPreview(t, {
        userId: 7,
        sql: sql.replace('ects =', 'ects  ='),
        now: at,
      }).ok,
    ).toBe(false);
  });
  it('rejects a tampered token', () => {
    const t = signPreview({ userId: 7, sql, affected: 12, at });
    const raw = Buffer.from(t, 'base64url').toString();
    const forged = Buffer.from(raw.replace('.12.', '.1.')).toString(
      'base64url',
    );
    expect(verifyPreview(forged, { userId: 7, sql, now: at }).ok).toBe(false);
    const flipped = t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA');
    expect(verifyPreview(flipped, { userId: 7, sql, now: at }).ok).toBe(false);
    expect(verifyPreview('', { userId: 7, sql, now: at }).ok).toBe(false);
    expect(verifyPreview('garbage!!', { userId: 7, sql, now: at }).ok).toBe(
      false,
    );
  });
  it('rejects a token from the future', () => {
    const t = signPreview({ userId: 7, sql, affected: 1, at });
    expect(verifyPreview(t, { userId: 7, sql, now: at - 1 }).ok).toBe(false);
  });
});

describe('adminSqlErrorMessage', () => {
  const dbErr = (errno: number, message = 'raw mariadb message') =>
    Object.assign(new Error(message), { errno });
  const perm =
    'Brak uprawnień: ta tabela jest poza zakresem konsoli administratora.';

  it('errno 1142 → the permission message', () => {
    expect(adminSqlErrorMessage(dbErr(1142))).toBe(perm);
  });
  it('1143 and 1044 → the permission message', () => {
    expect(adminSqlErrorMessage(dbErr(1143))).toBe(perm);
    expect(adminSqlErrorMessage(dbErr(1044))).toBe(perm);
  });
  it('1226 → busy, 1969/1317 → timeout', () => {
    expect(adminSqlErrorMessage(dbErr(1226))).toBe(BUSY_ERROR);
    expect(adminSqlErrorMessage(dbErr(1969))).toBe(timeoutMessage(5));
    expect(adminSqlErrorMessage(dbErr(1317))).toBe(timeoutMessage(5));
  });
  it('other errors → MariaDB message verbatim', () => {
    expect(adminSqlErrorMessage(dbErr(1062, "Duplicate entry 'a'"))).toBe(
      "Duplicate entry 'a'",
    );
    expect(adminSqlErrorMessage('weird')).toMatch(/\S/);
  });
});
