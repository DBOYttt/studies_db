'use client';

import { useState } from 'react';
import { Field } from '@/components/Field';
import { clearFeedAction, saveFeedAction } from '@/lib/admin-feeds';
import type { ActionState } from '@/lib/admin-forms';
import { fieldAria } from '@/lib/field-errors';
import { ActionButton, secondaryBtn } from './ActionButton';
import { ActionForm } from './ActionForm';
import { CardStatus, CardStatusArea } from './CardStatus';
import { hint, input, label, td, th } from './form-styles';

export type FeedCardRow = {
  semester: number;
  classMasked: string | null;
  examMasked: string | null;
  /** Already formatted (Warsaw time), or null when no feed is set. */
  updated: string | null;
};

const dash = <span className="text-faint">—</span>;
const notSet = <span className="text-muted">Not set</span>;
/** A masked link (`host/…#fingerprint`) in mono, or "Not set" in the body font. */
const feedCell = (masked: string | null) =>
  masked === null ? (
    notSet
  ) : (
    <span className="font-mono text-xs">{masked}</span>
  );

/**
 * Body of the "Timetable feeds" card: one row per semester. The page
 * refreshes itself (`AutoRefresh`) while a bot request is active;
 * `router.refresh` keeps this component's state, and the edit form's inputs
 * are uncontrolled, so what the admin is typing survives a refresh. Stored
 * links are never sent here (masked values only) and never prefill an input.
 */
export function FeedsCard({
  rows,
  hostHint,
}: {
  rows: FeedCardRow[];
  /** "Only https links on <first allowed host>." (from the server's env). */
  hostHint: string;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  // A cleared semester closes its edit row.
  const closeAfterClear = (semester: number) => (s: ActionState) => {
    if (s?.ok) setEditing((cur) => (cur === semester ? null : cur));
  };

  return (
    <CardStatus>
      <div className="overflow-x-auto">
        {/* Fixed columns: a row's buttons or an open form never move the
            feed columns. */}
        <table className="w-full min-w-[880px] table-fixed border-collapse text-[13px]">
          <colgroup>
            <col className="w-24" />
            <col />
            <col />
            <col className="w-52" />
            <col className="w-64" />
          </colgroup>
          <thead>
            <tr>
              <th className={th}>Semester</th>
              <th className={th}>Class feed</th>
              <th className={th}>Exam feed</th>
              <th className={th}>Updated</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const open = editing === r.semester;
              const zebra = i % 2 ? 'bg-zebra' : '';
              const editText = open ? 'Close' : r.classMasked ? 'Edit' : 'Set';
              return [
                <tr key={r.semester} className={zebra}>
                  <th
                    scope="row"
                    className={`${td} text-left whitespace-nowrap font-semibold`}
                  >
                    {r.semester}
                  </th>
                  <td className={`${td} break-all`}>
                    {feedCell(r.classMasked)}
                  </td>
                  <td className={`${td} break-all`}>
                    {feedCell(r.examMasked)}
                  </td>
                  <td className={`${td} whitespace-nowrap tabular-nums`}>
                    {r.updated ?? dash}
                  </td>
                  <td className={td}>
                    <div className="flex flex-wrap items-start justify-end gap-2">
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-controls={`feed-edit-${r.semester}`}
                        // The name starts with the visible text (WCAG 2.5.3).
                        aria-label={`${editText} semester ${r.semester} feed`}
                        className={`${secondaryBtn} max-sm:min-h-11`}
                        onClick={() => setEditing(open ? null : r.semester)}
                      >
                        {editText}
                      </button>
                      {r.classMasked !== null && (
                        <ActionButton
                          action={clearFeedAction}
                          fields={{ semester: String(r.semester) }}
                          label="Clear"
                          ariaLabel={`Clear semester ${r.semester} feed`}
                          pendingLabel="Clearing…"
                          cardStatus
                          onResult={closeAfterClear(r.semester)}
                          confirm={{
                            question: `Clear the semester ${r.semester} feeds? Its imported sessions are removed at the next successful sync.`,
                            confirmLabel: 'Confirm clear',
                          }}
                        />
                      )}
                    </div>
                  </td>
                </tr>,
                open && (
                  <tr key={`${r.semester}-edit`} className={zebra}>
                    <td colSpan={5} className="border-b border-line p-0">
                      <div id={`feed-edit-${r.semester}`}>
                        <ActionForm
                          action={saveFeedAction}
                          label={`Semester ${r.semester} feed`}
                          submitLabel="Save feed"
                          resetOnSuccess
                        >
                          {({ error, id }) => (
                            <>
                              <input
                                type="hidden"
                                name="semester"
                                value={r.semester}
                              />
                              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="flex min-w-0 flex-col gap-1">
                                  <Field
                                    className={label}
                                    error={error}
                                    formId={id}
                                    name="class_url"
                                  >
                                    Class feed link
                                    <input
                                      type="url"
                                      name="class_url"
                                      autoComplete="off"
                                      className={input}
                                      placeholder={
                                        r.classMasked
                                          ? 'Leave empty to keep the current link'
                                          : 'https://…'
                                      }
                                      {...fieldAria(
                                        error,
                                        id,
                                        'class_url',
                                        `${id}-class-hint`,
                                      )}
                                    />
                                  </Field>
                                  <span
                                    id={`${id}-class-hint`}
                                    className={hint}
                                  >
                                    {hostHint}
                                  </span>
                                </div>
                                <Field
                                  className={label}
                                  error={error}
                                  formId={id}
                                  name="exam_url"
                                >
                                  Exam feed link (optional)
                                  <input
                                    type="url"
                                    name="exam_url"
                                    autoComplete="off"
                                    className={input}
                                    placeholder={
                                      r.examMasked
                                        ? 'Leave empty to keep the current link'
                                        : 'https://…'
                                    }
                                    {...fieldAria(error, id, 'exam_url')}
                                  />
                                </Field>
                              </div>
                              {r.examMasked && (
                                <label className="flex items-center gap-2">
                                  <input type="checkbox" name="remove_exam" />
                                  Remove the exam feed
                                </label>
                              )}
                              <p className={`m-0 ${hint}`}>
                                Saving requests a timetable sync.
                              </p>
                            </>
                          )}
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
      <CardStatusArea />
    </CardStatus>
  );
}
