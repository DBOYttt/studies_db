'use client';

import { ECTS_MAX, ECTS_MIN, FIELD_MAX, SEMESTERS } from '@studies/db/fields';
import Link from 'next/link';
import { useId } from 'react';
import { addSubjectAction, editSubjectAction } from '@/lib/admin-actions';
import { subjectFormValues } from '@/lib/admin-form-values';
import { ActionForm } from './ActionForm';
import { hint, input, label, link, textarea } from './form-styles';
import { OrigInputs, useOrigSnapshot } from './OrigInputs';

export type SubjectFormValues = {
  code: string;
  name: string;
  semester: number;
  ects: number;
  description: string | null;
  platformUrl: string | null;
};

/**
 * "Add subject" (no `subject`) or "Edit subject" (the stored values; the
 * code is fixed, sent hidden). A new subject has no forum until setup runs,
 * which the success line says. On edit every field's rendered value is also
 * sent as a hidden `orig_<field>`, so the action changes only what was
 * touched and refuses a field someone else changed meanwhile. A stored
 * semester or ECTS outside today's range (written through the SQL console)
 * is shown as it is and kept unless changed.
 */
export function SubjectForm({ subject }: { subject?: SubjectFormValues }) {
  const id = useId();
  const add = subject === undefined;
  const values = add ? undefined : subjectFormValues(subject);
  const { orig, onSaved } = useOrigSnapshot(subject?.code ?? '', values ?? {});
  const oddSemester =
    subject !== undefined &&
    !(SEMESTERS as readonly number[]).includes(subject.semester);
  const ectsMin = Math.min(ECTS_MIN, subject?.ects ?? ECTS_MIN);
  const ectsMax = Math.max(ECTS_MAX, subject?.ects ?? ECTS_MAX);
  return (
    <ActionForm
      action={add ? addSubjectAction : editSubjectAction}
      submitLabel={add ? 'Add subject' : 'Save subject'}
      pendingLabel={add ? 'Adding…' : 'Saving…'}
      resetOnSuccess={add}
      onSaved={add ? undefined : onSaved}
      successText={
        add
          ? () => (
              <>
                Subject added. Run setup on the{' '}
                <Link href="/admin/sync" className={link}>
                  Sync tab
                </Link>{' '}
                to create its forum.
              </>
            )
          : undefined
      }
    >
      {add ? null : <input type="hidden" name="code" value={subject.code} />}
      {add ? null : <OrigInputs values={orig} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <label className={label}>
          Name
          <input
            name="name"
            required
            maxLength={FIELD_MAX.subjectName}
            defaultValue={values?.name}
            autoComplete="off"
            className={input}
          />
        </label>
        {add && (
          <div className="flex min-w-0 flex-col gap-1">
            <label className={label}>
              Code
              <input
                name="code"
                required
                maxLength={FIELD_MAX.subjectCode}
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${id}-code`}
                className={`${input} font-mono uppercase`}
              />
            </label>
            <span id={`${id}-code`} className={hint}>
              Letters, digits, . - _
            </span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:max-w-[18rem]">
        <label className={label}>
          Semester
          <select
            name="semester"
            defaultValue={values?.semester ?? '1'}
            className={input}
          >
            {oddSemester && (
              <option value={values?.semester}>{values?.semester}</option>
            )}
            {SEMESTERS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          ECTS
          <input
            name="ects"
            type="number"
            required
            min={ectsMin}
            max={ectsMax}
            step={1}
            defaultValue={values?.ects}
            className={`${input} tabular-nums`}
          />
        </label>
      </div>
      <label className={label}>
        Description
        <textarea
          name="description"
          maxLength={FIELD_MAX.description}
          defaultValue={values?.description ?? ''}
          className={textarea}
          lang="pl"
        />
      </label>
      {!add && (
        <div className="flex min-w-0 flex-col gap-1">
          <label className={label}>
            Course platform link
            <input
              name="platformUrl"
              inputMode="url"
              maxLength={FIELD_MAX.platformUrl}
              defaultValue={values?.platformUrl}
              placeholder="https://…"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${id}-url`}
              className={input}
            />
          </label>
          <span id={`${id}-url`} className={hint}>
            Leave a field empty to remove it.
          </span>
        </div>
      )}
    </ActionForm>
  );
}
