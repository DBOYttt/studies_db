/**
 * Field limits shared by the slash-command options (`definitions.ts`) and the
 * admin panel modals (`ui/views/modals.ts`), so both accept the same input,
 * and by the web admin forms. Keep it free of imports: client components load
 * it as `@studies/db/fields`.
 */

/** Max lengths of free-text fields. */
export const FIELD_MAX = {
  subjectName: 200,
  subjectCode: 20,
  description: 1000,
  platformUrl: 500,
  lecturerName: 200,
  lecturerTitle: 50,
  email: 200,
  officeHours: 500,
  room: 100,
  classNote: 500,
} as const;

export const SEMESTERS = [1, 2, 3, 4, 5, 6, 7] as const;
export type Semester = (typeof SEMESTERS)[number];

export function isSemester(n: unknown): n is Semester {
  return (SEMESTERS as readonly unknown[]).includes(n);
}
export const ECTS_MIN = 0;
export const ECTS_MAX = 30;
export const GROUP_MIN = 1;
export const GROUP_MAX = 99;
