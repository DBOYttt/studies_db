import { describe, expect, it } from 'vitest';
import { sanitizeDbMessage } from '../lib/sql-messages';

describe('sanitizeDbMessage', () => {
  it('drops user, host and schema from a table denial', () => {
    expect(
      sanitizeDbMessage(
        "SELECT command denied to user 'studies_ro_qa'@'10.88.0.2' for table `studies_qa_test`.`users`",
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
      sanitizeDbMessage("Access denied for user 'u'@'%' to database 'studies'"),
    ).toBe('Access denied to database');
  });
  it('leaves syntax errors alone', () => {
    const m =
      "You have an error in your SQL syntax; check the manual near 'FROM users' at line 1";
    expect(sanitizeDbMessage(m)).toBe(m);
  });
});
