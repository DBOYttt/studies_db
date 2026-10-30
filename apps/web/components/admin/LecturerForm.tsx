'use client';

import { FIELD_MAX } from '@studies/db/fields';
import { Field } from '@/components/Field';
import { addLecturerAction, editLecturerAction } from '@/lib/admin-actions';
import { lecturerFormValues } from '@/lib/admin-form-values';
import { fieldAria } from '@/lib/field-errors';
import { ActionForm } from './ActionForm';
import { hint, input, label } from './form-styles';
import { OrigInputs, useOrigSnapshot } from './OrigInputs';

export type LecturerFormValues = {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  officeHours: string | null;
  room: string | null;
};

/**
 * "Add lecturer" (no `lecturer`) or "Edit lecturer" (id sent hidden). On
 * edit every field's rendered value is also sent as a hidden
 * `orig_<field>`, so the action changes only what was touched and refuses a
 * field someone else changed meanwhile.
 */
export function LecturerForm({ lecturer }: { lecturer?: LecturerFormValues }) {
  const add = lecturer === undefined;
  const values = add ? undefined : lecturerFormValues(lecturer);
  const { orig, onSaved } = useOrigSnapshot(
    String(lecturer?.id ?? ''),
    values ?? {},
  );
  return (
    <ActionForm
      action={add ? addLecturerAction : editLecturerAction}
      submitLabel={add ? 'Add lecturer' : 'Save lecturer'}
      pendingLabel={add ? 'Adding…' : 'Saving…'}
      resetOnSuccess={add}
      onSaved={add ? undefined : onSaved}
    >
      {(f) => (
        <>
          {add ? null : <input type="hidden" name="id" value={lecturer.id} />}
          {add ? null : <OrigInputs values={orig} />}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <Field className={label} error={f.error} formId={f.id} name="title">
              Title
              <input
                name="title"
                maxLength={FIELD_MAX.lecturerTitle}
                defaultValue={values?.title ?? ''}
                placeholder="dr hab."
                autoComplete="off"
                {...fieldAria(f.error, f.id, 'title')}
                className={input}
                lang="pl"
              />
            </Field>
            <Field className={label} error={f.error} formId={f.id} name="name">
              Name
              <input
                name="name"
                required
                maxLength={FIELD_MAX.lecturerName}
                defaultValue={values?.name}
                autoComplete="off"
                {...fieldAria(f.error, f.id, 'name')}
                className={input}
                lang="pl"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <Field className={label} error={f.error} formId={f.id} name="email">
              Email
              <input
                name="email"
                inputMode="email"
                maxLength={FIELD_MAX.email}
                defaultValue={values?.email ?? ''}
                autoComplete="off"
                spellCheck={false}
                {...fieldAria(f.error, f.id, 'email')}
                className={input}
              />
            </Field>
            <Field className={label} error={f.error} formId={f.id} name="room">
              Room
              <input
                name="room"
                maxLength={FIELD_MAX.room}
                defaultValue={values?.room ?? ''}
                autoComplete="off"
                {...fieldAria(f.error, f.id, 'room')}
                className={input}
              />
            </Field>
          </div>
          <Field
            className={label}
            error={f.error}
            formId={f.id}
            name="officeHours"
          >
            Office hours
            <input
              name="officeHours"
              maxLength={FIELD_MAX.officeHours}
              defaultValue={values?.officeHours ?? ''}
              autoComplete="off"
              {...fieldAria(f.error, f.id, 'officeHours')}
              className={input}
              lang="pl"
            />
          </Field>
          {!add && (
            <span className={`${hint} -mt-1.5`}>
              Leave a field empty to remove it.
            </span>
          )}
        </>
      )}
    </ActionForm>
  );
}
