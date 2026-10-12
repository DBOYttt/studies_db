import { describe, expect, it } from 'vitest';
import {
  entityGridQuery,
  parseEntityGrid,
  parseEntityId,
  parseEntityTab,
} from '../lib/entity-page';

describe('parseEntityId', () => {
  it('accepts 1-9 digit positive ids only', () => {
    expect(parseEntityId('7')).toBe(7);
    expect(parseEntityId('999999999')).toBe(999999999);
    for (const bad of ['0', '01', 'abc', '-1', '1e3', '1234567890', '']) {
      expect(parseEntityId(bad)).toBeNull();
    }
  });
});

describe('parseEntityTab', () => {
  const tabs = ['classes', 'files'] as const;
  it('defaults to the first tab', () => {
    expect(parseEntityTab({}, tabs)).toBe('classes');
    expect(parseEntityTab({ tab: 'nope' }, tabs)).toBe('classes');
    expect(parseEntityTab({ tab: ['files', 'x'] }, tabs)).toBe('files');
  });
  it('parses the lecturer Plan tab', () => {
    const lecturerTabs = ['classes', 'files', 'plan'] as const;
    expect(parseEntityTab({ tab: 'plan' }, lecturerTabs)).toBe('plan');
    expect(parseEntityTab({ tab: 'plan' }, tabs)).toBe('classes');
  });
});

describe('parseEntityGrid / entityGridQuery', () => {
  it('drops dir without sort and parses preview', () => {
    expect(parseEntityGrid({ dir: 'desc', preview: '5' })).toEqual({
      page: 1,
      perPage: 25,
      sort: undefined,
      dir: undefined,
      preview: 5,
    });
  });
  it('round-trips non-default params', () => {
    const g = parseEntityGrid({
      sort: 'filename',
      dir: 'desc',
      per: '50',
      page: '2',
      preview: 'x',
    });
    expect(g.preview).toBeNull();
    expect(entityGridQuery('files', g, 2)).toBe(
      'tab=files&sort=filename&dir=desc&per=50&page=2',
    );
    expect(entityGridQuery(null, { perPage: 25 }, 1)).toBe('');
  });
});
