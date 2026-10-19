import { describe, expect, it } from 'vitest';
import { parseEventAction } from '../src/ui/events.js';

describe('parseEventAction version argument', () => {
  it('save reads scope then v<version>', () => {
    expect(parseEventAction('save', ['5', 'one', 'v3'], 'modal', [])).toEqual({
      kind: 'save',
      id: 5,
      scope: 'one',
      version: 3,
    });
    expect(parseEventAction('save', ['5', 'one'], 'modal', [])).toMatchObject({
      version: null,
    });
    expect(parseEventAction('save', ['5', 'one', 'x'], 'modal', [])).toBeNull();
    expect(parseEventAction('save', ['new'], 'modal', [])).toEqual({
      kind: 'save',
      id: null,
      scope: 'one',
      version: null,
    });
  });

  it('delok reads scope then v<version>', () => {
    expect(
      parseEventAction('delok', ['5', 'following', 'v12'], 'button', []),
    ).toEqual({ kind: 'delok', id: 5, scope: 'following', version: 12 });
    expect(parseEventAction('delok', ['5'], 'button', [])).toMatchObject({
      scope: 'one',
      version: null,
    });
    expect(
      parseEventAction('delok', ['5', 'one', 'x'], 'button', []),
    ).toBeNull();
  });
});
