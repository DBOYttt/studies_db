'use client';

import {
  CLASS_KINDS,
  CLASS_NAMES,
  type ClassKind,
} from '@studies/db/constants';
import { GROUP_MAX, GROUP_MIN } from '@studies/db/fields';
import { useId } from 'react';
import { Field } from '@/components/Field';
import { assignLecturerAction } from '@/lib/admin-actions';
import { fieldAria } from '@/lib/field-errors';
import { ActionForm } from './ActionForm';
import { hint, input, label } from './form-styles';

export type LecturerOption = { id: number; label: string };

/**
 * Assigns a lecturer to a class of the subject, for all groups or one. With
 * `kind` the class is fixed (a class card); without it the admin picks the
 * class type, and a type the subject lacks is created.
 */
export function AssignLecturerForm({
  code,
  kind,
  lecturers,
  label: formLabel,
}: {
  code: string;
  kind?: ClassKind;
  lecturers: LecturerOption[];
  label?: string;
}) {
  const id = useId();
  return (
    <ActionForm
      action={assignLecturerAction}
      submitLabel="Assign"
      pendingLabel="Assigning…"
      resetOnSuccess
      label={formLabel}
    >
      {(f) => (
        <>
          <input type="hidden" name="code" value={code} />
          {kind && <input type="hidden" name="kind" value={kind} />}
          {/* Label above control, full width. The subject-wide form sits in a
          narrow column, so it always stacks; a class card puts Group beside
          the lecturer only when the card's column is at least 20rem wide. */}
          <div className="@container">
            <div
              className={
                kind
                  ? 'flex flex-col gap-3 @xs:grid @xs:grid-cols-[minmax(10rem,1fr)_7rem]'
                  : 'flex flex-col gap-3'
              }
            >
              <Field
                className={label}
                error={f.error}
                formId={f.id}
                name="lecturerId"
              >
                Lecturer
                <select
                  name="lecturerId"
                  required
                  defaultValue=""
                  {...fieldAria(f.error, f.id, 'lecturerId')}
                  className={`${input} min-w-0`}
                >
                  <option value="" disabled>
                    Choose a lecturer
                  </option>
                  {lecturers.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </Field>
              {!kind && (
                <Field
                  className={label}
                  error={f.error}
                  formId={f.id}
                  name="kind"
                >
                  Class type
                  <select
                    name="kind"
                    required
                    defaultValue=""
                    {...fieldAria(f.error, f.id, 'kind')}
                    className={`${input} min-w-0`}
                  >
                    <option value="" disabled>
                      Choose a class type
                    </option>
                    {CLASS_KINDS.map((k) => (
                      <option key={k} value={k} lang="pl">
                        {CLASS_NAMES[k]}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field
                className={label}
                error={f.error}
                formId={f.id}
                name="group"
              >
                Group
                <input
                  name="group"
                  type="number"
                  min={GROUP_MIN}
                  max={GROUP_MAX}
                  step={1}
                  {...fieldAria(f.error, f.id, 'group', `${id}-group`)}
                  className={`${input} tabular-nums`}
                />
              </Field>
            </div>
          </div>
          <span id={`${id}-group`} className={`${hint} -mt-1.5`}>
            Leave the group empty to assign the lecturer to all groups.
          </span>
        </>
      )}
    </ActionForm>
  );
}
