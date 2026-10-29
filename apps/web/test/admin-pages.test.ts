import { describe, expect, it } from 'vitest';
import { lecturerLabel, parseSubjectParam } from '@/lib/admin-pages';

describe('parseSubjectParam', () => {
  it('trims and upper-cases, decoded or not', () => {
    expect(parseSubjectParam('ana1')).toBe('ANA1');
    expect(parseSubjectParam(' asd')).toBe('ASD');
    expect(parseSubjectParam('%20asd%20')).toBe('ASD');
    expect(parseSubjectParam('Mat.1_a-b')).toBe('MAT.1_A-B');
  });
  it('refuses what cannot be a code', () => {
    expect(parseSubjectParam('')).toBeNull();
    expect(parseSubjectParam('   ')).toBeNull();
    expect(parseSubjectParam('a b')).toBeNull();
    expect(parseSubjectParam('%E0%A4%A')).toBeNull();
    expect(parseSubjectParam('x'.repeat(21))).toBeNull();
    expect(parseSubjectParam("A1' OR 1=1")).toBeNull();
  });
});

describe('lecturerLabel', () => {
  it('puts the title first when there is one', () => {
    expect(lecturerLabel({ title: 'dr', name: 'Ewa Nowak' })).toBe(
      'dr Ewa Nowak',
    );
    expect(lecturerLabel({ title: null, name: 'Ewa Nowak' })).toBe('Ewa Nowak');
  });
});
