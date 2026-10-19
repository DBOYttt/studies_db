import { describe, expect, it } from 'vitest';
import { nextFormVersion } from '../lib/event-form-version';

const live = (version: number) => ({ version, deleted: false });
const gone = (version: number) => ({ version, deleted: true });

describe('nextFormVersion', () => {
  it('keeps the version on a plain refresh, even when it changed', () => {
    expect(nextFormVersion(live(5), live(5))).toEqual(live(5));
    expect(nextFormVersion(live(5), live(6))).toEqual(live(5));
  });
  it('follows a delete and a restore with nothing in between', () => {
    const deleted = nextFormVersion(live(5), gone(6));
    expect(deleted).toEqual(gone(6));
    expect(nextFormVersion(deleted, live(7))).toEqual(live(7));
  });
  it('a form opened on a deleted event follows its restore', () => {
    expect(nextFormVersion(gone(3), live(4))).toEqual(live(4));
  });
  it('an edit before the delete keeps the old version through the restore', () => {
    // B edits (6) and deletes (7) while the form is on 5; then a restore (8).
    const deleted = nextFormVersion(live(5), gone(7));
    expect(deleted).toEqual(gone(5));
    expect(nextFormVersion(deleted, live(8))).toEqual(live(5));
  });
  it('a delete, restore and delete again by others is not followed', () => {
    // On a deleted form (3): restored (4) and deleted (5) unseen, restored (6).
    expect(nextFormVersion(gone(3), live(6))).toEqual(live(3));
  });
  it('a new event (no version) stays without one', () => {
    expect(
      nextFormVersion({ version: undefined, deleted: false }, gone(1)),
    ).toEqual({ version: undefined, deleted: true });
  });
});
