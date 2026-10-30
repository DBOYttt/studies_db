'use client';

import {
  ASSESSMENT_NAMES,
  ASSESSMENTS,
  CLASS_NAMES,
  type ClassKind,
} from '@studies/db/constants';
import { FIELD_MAX } from '@studies/db/fields';
import { editClassAction } from '@/lib/admin-actions';
import { classFormValues, origName } from '@/lib/admin-form-values';
import { ActionForm } from './ActionForm';
import { hint, input, label } from './form-styles';

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
  return (
    <ActionForm
      action={editClassAction}
      submitLabel="Save class"
      label={`${CLASS_NAMES[kind]} settings`}
    >
      <input type="hidden" name="code" value={code} />
      <input type="hidden" name="kind" value={kind} />
      {Object.entries(values).map(([k, v]) => (
        <input key={k} type="hidden" name={origName(k)} value={v} />
      ))}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <label className={label}>
          Assessment
          {/* Keyed by the stored value: React does not re-apply a select's
              defaultValue, and the hidden orig follows a refresh. */}
          <select
            key={values.assessment}
            name="assessment"
            defaultValue={values.assessment}
            className={input}
          >
            <option value="">None</option>
            {ASSESSMENTS.map((a) => (
              <option key={a} value={a}>
                {ASSESSMENT_NAMES[a]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Note
          <input
            name="note"
            maxLength={FIELD_MAX.classNote}
            defaultValue={values.note}
            autoComplete="off"
            className={input}
            lang="pl"
          />
        </label>
      </div>
      <label className={label}>
        Course platform link
        <input
          name="platformUrl"
          inputMode="url"
          maxLength={FIELD_MAX.platformUrl}
          defaultValue={values.platformUrl}
          placeholder="https://…"
          autoComplete="off"
          spellCheck={false}
          className={input}
        />
      </label>
      <span className={`${hint} -mt-1.5`}>
        Leave a field empty to remove it.
      </span>
    </ActionForm>
  );
}
