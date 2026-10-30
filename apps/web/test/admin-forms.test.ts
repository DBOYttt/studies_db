import { describe, expect, it } from 'vitest';
import { currentSnapshot, savedSnapshot } from '@/lib/admin-form-values';
import {
  CONFLICT_MESSAGE,
  classFormValues,
  field,
  LECTURER_FIELD_LABELS,
  lecturerFormValues,
  parseSubjectEdit,
  resolveEdit,
  SUBJECT_FIELD_LABELS,
  sameUrl,
  subjectFormValues,
} from '@/lib/admin-forms';

describe('field', () => {
  it('normalises CRLF and lone CR to LF', () => {
    const f = new FormData();
    f.set('a', 'x\r\ny\rz\n');
    expect(field(f, 'a')).toBe('x\ny\nz\n');
  });
  it('reads a missing or file entry as empty', () => {
    const f = new FormData();
    f.set('file', new Blob(['x']));
    expect(field(f, 'nope')).toBe('');
    expect(field(f, 'file')).toBe('');
  });
});

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describe('*FormValues', () => {
  it('renders nulls as empty strings and numbers as text', () => {
    expect(
      subjectFormValues({
        name: 'A',
        semester: 3,
        ects: 40,
        description: null,
        platformUrl: null,
      }),
    ).toEqual({
      name: 'A',
      semester: '3',
      ects: '40',
      description: '',
      platformUrl: '',
    });
    expect(
      classFormValues({ assessment: null, note: 'n', platformUrl: null }),
    ).toEqual({ assessment: '', note: 'n', platformUrl: '' });
    expect(
      lecturerFormValues({
        name: 'J',
        title: null,
        email: 'j@x.pl',
        officeHours: null,
        room: 'A1',
      }),
    ).toEqual({
      name: 'J',
      title: '',
      email: 'j@x.pl',
      officeHours: '',
      room: 'A1',
    });
  });
});

describe('resolveEdit', () => {
  const cur = {
    name: 'B',
    semester: '1',
    ects: '5',
    description: 'x\ny',
    platformUrl: 'https://b.example',
  };
  const all = (o: Record<string, string>, orig: Record<string, string>) =>
    form({
      ...o,
      ...Object.fromEntries(
        Object.entries(orig).map(([k, v]) => [`orig_${k}`, v]),
      ),
    });

  it('without orig_* every field is touched and the form is unchanged', () => {
    const r = resolveEdit(form({ name: 'A' }), cur, SUBJECT_FIELD_LABELS);
    expect(r.ok && [...r.touched]).toEqual(Object.keys(SUBJECT_FIELD_LABELS));
    expect(r.ok && r.form.get('name')).toBe('A');
  });

  it('untouched fields carry the stored value; touched ones the submitted', () => {
    const orig = { ...cur, name: 'A', ects: '5' };
    const r = resolveEdit(
      all({ ...orig, ects: '6' }, orig),
      cur,
      SUBJECT_FIELD_LABELS,
    );
    if (!r.ok) throw new Error(r.message);
    expect([...r.touched]).toEqual(['ects']);
    expect(r.form.get('name')).toBe('B');
    expect(r.form.get('ects')).toBe('6');
  });

  it('a CRLF description equal to its orig is untouched', () => {
    const r = resolveEdit(
      all({ ...cur, description: 'x\r\ny' }, cur),
      cur,
      SUBJECT_FIELD_LABELS,
    );
    expect(r.ok && [...r.touched]).toEqual([]);
  });

  it('names every conflicting field by its label, in form order', () => {
    const orig = { ...cur, ects: '4', platformUrl: 'https://a.example' };
    const r = resolveEdit(
      all({ ...orig, ects: '7', platformUrl: 'https://c.example' }, orig),
      cur,
      SUBJECT_FIELD_LABELS,
    );
    expect(r).toEqual({
      ok: false,
      message: CONFLICT_MESSAGE(['ECTS', 'course platform link']),
    });
    expect(CONFLICT_MESSAGE(['name'])).toBe(
      'Someone else changed name meanwhile. Reload the page to see the new values.',
    );
  });

  it('no conflict when both admins chose the same value', () => {
    // B renamed A to B and set the URL meanwhile; A typed the same values.
    const orig = { ...cur, name: 'A', platformUrl: '' };
    const r = resolveEdit(
      all(
        { ...orig, name: 'B', ects: '6', platformUrl: 'https://b.example ' },
        orig,
      ),
      cur,
      SUBJECT_FIELD_LABELS,
    );
    if (!r.ok) throw new Error(r.message);
    expect([...r.touched]).toEqual(['ects']);
    expect(r.form.get('name')).toBe('B');
    expect(r.form.get('platformUrl')).toBe('https://b.example');
  });

  it('uses the lecturer labels', () => {
    const lc = {
      name: 'J',
      title: 'dr',
      email: '',
      officeHours: 'x',
      room: '',
    };
    const orig = { ...lc, officeHours: 'old' };
    const r = resolveEdit(
      all({ ...orig, officeHours: 'new' }, orig),
      lc,
      LECTURER_FIELD_LABELS,
    );
    expect(r).toEqual({
      ok: false,
      message: CONFLICT_MESSAGE(['office hours']),
    });
  });
});

describe('sameUrl', () => {
  it('compares as the stored-URL rule does', () => {
    expect(sameUrl('https://a.example ', 'https://a.example')).toBe(true);
    expect(sameUrl('', '-')).toBe(true);
    expect(sameUrl('ftp://x', 'ftp://x')).toBe(true);
    expect(sameUrl('ftp://x ', 'ftp://x')).toBe(false);
    expect(sameUrl('https://a.example', 'https://b.example')).toBe(false);
  });
});

describe('parseSubjectEdit: stored semester/ECTS (C9)', () => {
  const base = { code: 'X', name: 'N', description: '', platformUrl: '' };
  it('accepts a stored out-of-range value unchanged, refuses another', () => {
    expect(
      parseSubjectEdit(form({ ...base, semester: '3', ects: '40' }), {
        semester: 3,
        ects: 40,
      }),
    ).toMatchObject({ ok: true, value: { semester: 3, ects: 40 } });
    expect(
      parseSubjectEdit(form({ ...base, semester: '4', ects: '40' }), {
        semester: 3,
        ects: 40,
      }),
    ).toEqual({
      ok: false,
      message: 'Semester must be 1 or 2.',
      field: 'semester',
    });
    expect(
      parseSubjectEdit(form({ ...base, semester: '1', ects: '41' }), {
        semester: 3,
        ects: 40,
      }).ok,
    ).toBe(false);
    expect(
      parseSubjectEdit(form({ ...base, semester: '3', ects: '5' })).ok,
    ).toBe(false);
  });
});

describe('orig snapshot', () => {
  const server = { name: 'A', note: '' };
  it('stays put while the server values change for the same record', () => {
    const snap = currentSnapshot(null, 'X', server);
    expect(snap).toEqual({ key: 'X', values: server });
    // A refresh caused by another form brings B's values: not taken.
    expect(currentSnapshot(snap, 'X', { name: 'B', note: 'n' })).toBe(snap);
  });

  it('starts again for another record', () => {
    const snap = currentSnapshot(null, 'X', server);
    expect(currentSnapshot(snap, 'Y', { name: 'B', note: '' })).toEqual({
      key: 'Y',
      values: { name: 'B', note: '' },
    });
  });

  it('advances to what this form submitted after its own save', () => {
    const snap = currentSnapshot(null, 'X', server);
    const data = form({ name: 'A2', note: 'x', orig_name: 'A', other: '1' });
    expect(savedSnapshot(snap, data)).toEqual({
      key: 'X',
      values: { name: 'A2', note: 'x' },
    });
    // A field the form did not send keeps its snapshot.
    expect(savedSnapshot(snap, form({ name: 'A3' })).values).toEqual({
      name: 'A3',
      note: '',
    });
  });
});
