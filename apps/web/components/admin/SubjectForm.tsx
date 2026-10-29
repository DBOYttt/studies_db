'use client';

import { ECTS_MAX, ECTS_MIN, FIELD_MAX, SEMESTERS } from '@studies/db/fields';
import Link from 'next/link';
import { useId } from 'react';
import { addSubjectAction, editSubjectAction } from '@/lib/admin-actions';
import { ActionForm } from './ActionForm';
import { hint, input, label, link, textarea } from './form-styles';

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
 * which the success line says.
 */
export function SubjectForm({ subject }: { subject?: SubjectFormValues }) {
  const id = useId();
  const add = subject === undefined;
  return (
    <ActionForm
      action={add ? addSubjectAction : editSubjectAction}
      submitLabel={add ? 'Add subject' : 'Save subject'}
      pendingLabel={add ? 'Adding…' : 'Saving…'}
      resetOnSuccess={add}
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <label className={label}>
          Name
          <input
            name="name"
            required
            maxLength={FIELD_MAX.subjectName}
            defaultValue={subject?.name}
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
            defaultValue={String(subject?.semester ?? 1)}
            className={input}
          >
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
            min={ECTS_MIN}
            max={ECTS_MAX}
            step={1}
            defaultValue={subject?.ects}
            className={`${input} tabular-nums`}
          />
        </label>
      </div>
      <label className={label}>
        Description
        <textarea
          name="description"
          maxLength={FIELD_MAX.description}
          defaultValue={subject?.description ?? ''}
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
              defaultValue={subject.platformUrl ?? ''}
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
