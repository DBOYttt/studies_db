/**
 * The strings the admin edit forms render as `defaultValue`, and also as the
 * hidden `orig_<field>` copies the edit actions compare against
 * (`resolveEdit`, `admin-forms.ts`). Import-free, so both the client forms
 * and the server actions can use it: `admin-forms.ts` itself pulls in
 * `@studies/db`.
 */

export type SubjectValuesInput = {
  name: string;
  semester: number;
  ects: number;
  description: string | null;
  platformUrl: string | null;
};

export function subjectFormValues(cur: SubjectValuesInput) {
  return {
    name: cur.name,
    semester: String(cur.semester),
    ects: String(cur.ects),
    description: cur.description ?? '',
    platformUrl: cur.platformUrl ?? '',
  };
}

export type ClassValuesInput = {
  assessment: string | null;
  note: string | null;
  platformUrl: string | null;
};

export function classFormValues(cur: ClassValuesInput) {
  return {
    assessment: cur.assessment ?? '',
    note: cur.note ?? '',
    platformUrl: cur.platformUrl ?? '',
  };
}

export type LecturerValuesInput = {
  name: string;
  title: string | null;
  email: string | null;
  officeHours: string | null;
  room: string | null;
};

export function lecturerFormValues(cur: LecturerValuesInput) {
  return {
    name: cur.name,
    title: cur.title ?? '',
    email: cur.email ?? '',
    officeHours: cur.officeHours ?? '',
    room: cur.room ?? '',
  };
}

/** The labels the forms show, in form order, for the conflict message. */
export const SUBJECT_FIELD_LABELS = {
  name: 'name',
  semester: 'semester',
  ects: 'ECTS',
  description: 'description',
  platformUrl: 'course platform link',
} as const;

export const CLASS_FIELD_LABELS = {
  assessment: 'assessment',
  note: 'note',
  platformUrl: 'course platform link',
} as const;

export const LECTURER_FIELD_LABELS = {
  title: 'title',
  name: 'name',
  email: 'email',
  room: 'room',
  officeHours: 'office hours',
} as const;

export const CONFLICT_MESSAGE = (fields: string[]) =>
  `Someone else changed ${fields.join(', ')} meanwhile. Reload the page to see the new values.`;

/** The hidden `orig_<field>` name of a form field. */
export const origName = (f: string) => `orig_${f}`;
