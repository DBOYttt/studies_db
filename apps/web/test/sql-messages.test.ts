import { describe, expect, it } from 'vitest';
import { sanitizeDbMessage } from '../lib/sql-messages';

const DB = ['studies_qa_test'];

describe('sanitizeDbMessage', () => {
  it('drops user, host and schema from a table denial', () => {
    expect(
      sanitizeDbMessage(
        "SELECT command denied to user 'studies_ro_qa'@'10.88.0.2' for table `studies_qa_test`.`users`",
        DB,
      ),
    ).toBe('SELECT command denied for table `users`');
  });
  it('drops user and host from a column denial', () => {
    expect(
      sanitizeDbMessage(
        "UPDATE command denied to user 'u'@'h' for column 'topic_id' in table 'events'",
      ),
    ).toBe("UPDATE command denied for column 'topic_id' in table 'events'");
  });
  it('collapses a database denial', () => {
    expect(
      sanitizeDbMessage(
        "Access denied for user 'u'@'%' to database 'studies'",
        DB,
      ),
    ).toBe('Access denied to database');
  });
  it('leaves syntax errors alone', () => {
    const m =
      "You have an error in your SQL syntax; check the manual near 'FROM users' at line 1";
    expect(sanitizeDbMessage(m, DB)).toBe(m);
  });
  it('strips the schema from unquoted and in-quote forms', () => {
    const f = (m: string) => sanitizeDbMessage(m, DB);
    expect(f('FUNCTION studies_qa_test.nosuchfn does not exist')).toBe(
      'FUNCTION nosuchfn does not exist',
    );
    expect(f("Table 'studies_qa_test.x' doesn't exist")).toBe(
      "Table 'x' doesn't exist",
    );
    expect(f("execute command denied for routine 'studies_qa_test.f'")).toBe(
      "execute command denied for routine 'f'",
    );
  });
  it('never touches the echoed SQL in a near clause', () => {
    const f = (m: string) => sanitizeDbMessage(m, DB);
    const a =
      "You have an error in your SQL syntax; check the manual near 'FROM `subjects`.`name`' at line 1";
    const b =
      "You have an error in your SQL syntax; check the manual near ''a'.b' at line 1";
    const c =
      "You have an error in your SQL syntax; near 'x studies_qa_test.t' at line 1";
    expect(f(a)).toBe(a);
    expect(f(b)).toBe(b);
    expect(f(c)).toBe(c);
  });
});
