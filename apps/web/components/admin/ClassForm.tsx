'use client';

import {
  ASSESSMENT_NAMES,
  ASSESSMENTS,
  CLASS_NAMES,
  type ClassKind,
} from '@studies/db/constants';
import { FIELD_MAX } from '@studies/db/fields';
import { Field } from '@/components/Field';
import { editClassAction } from '@/lib/admin-actions';
import { classFormValues } from '@/lib/admin-form-values';
import { fieldAria } from '@/lib/field-errors';
import { ActionForm } from './ActionForm';
import { hint, input, label } from './form-styles';
import { OrigInputs, useOrigSnapshot } from './OrigInputs';

/**
 * The settings of one class (assessment, note, platform link). Each field's
 * rendered value is also sent as a hidden `orig_<field>`, so the action
 * changes only what was touched and refuses a field someone else changed
 * meanwhile.
 */
export function ClassForm({
  code,
  kind,
  assessment,
  note,
  platformUrl,
}: {
  code: string;
  kind: ClassKind;
  assessment: string | null;
  note: string | null;
  platformUrl: string | null;
}) {
  const values = classFormValues({ assessment, note, platformUrl });
  const { orig, onSaved } = useOrigSnapshot(`${code}:${kind}`, values);
  return (
    <ActionForm
      action={editClassAction}
      submitLabel="Save class"
      onSaved={onSaved}
      label={`${CLASS_NAMES[kind]} settings`}
    >
      {(f) => (
        <>
          <input type="hidden" name="code" value={code} />
          <input type="hidden" name="kind" value={kind} />
          <OrigInputs values={orig} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
            <Field
              className={label}
              error={f.error}
              formId={f.id}
              name="assessment"
            >
              Assessment
              <select
                name="assessment"
                defaultValue={values.assessment}
                {...fieldAria(f.error, f.id, 'assessment')}
                className={input}
              >
                <option value="">None</option>
                {ASSESSMENTS.map((a) => (
                  <option key={a} value={a}>
                    {ASSESSMENT_NAMES[a]}
                  </option>
                ))}
              </select>
            </Field>
            <Field className={label} error={f.error} formId={f.id} name="note">
              Note
              <input
                name="note"
                maxLength={FIELD_MAX.classNote}
                defaultValue={values.note}
                autoComplete="off"
                {...fieldAria(f.error, f.id, 'note')}
                className={input}
                lang="pl"
              />
            </Field>
          </div>
          <Field
            className={label}
            error={f.error}
            formId={f.id}
            name="platformUrl"
          >
            Course platform link
            <input
              name="platformUrl"
              inputMode="url"
              maxLength={FIELD_MAX.platformUrl}
              defaultValue={values.platformUrl}
              placeholder="https://…"
              autoComplete="off"
              spellCheck={false}
              {...fieldAria(f.error, f.id, 'platformUrl')}
              className={input}
            />
          </Field>
          <span className={`${hint} -mt-1.5`}>
            Leave a field empty to remove it.
          </span>
        </>
      )}
    </ActionForm>
  );
}
