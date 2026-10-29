'use client';

import { FIELD_MAX } from '@studies/db/fields';
import { addLecturerAction, editLecturerAction } from '@/lib/admin-actions';
import { ActionForm } from './ActionForm';
import { hint, input, label } from './form-styles';

export type LecturerFormValues = {
  id: number;
  name: string;
  title: string | null;
  email: string | null;
  officeHours: string | null;
  room: string | null;
};

/** "Add lecturer" (no `lecturer`) or "Edit lecturer" (id sent hidden). */
export function LecturerForm({ lecturer }: { lecturer?: LecturerFormValues }) {
  const add = lecturer === undefined;
  return (
    <ActionForm
      action={add ? addLecturerAction : editLecturerAction}
      submitLabel={add ? 'Add lecturer' : 'Save lecturer'}
      pendingLabel={add ? 'Adding…' : 'Saving…'}
      resetOnSuccess={add}
    >
      {add ? null : <input type="hidden" name="id" value={lecturer.id} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <label className={label}>
          Title
          <input
            name="title"
            maxLength={FIELD_MAX.lecturerTitle}
            defaultValue={lecturer?.title ?? ''}
            placeholder="dr hab."
            autoComplete="off"
            className={input}
            lang="pl"
          />
        </label>
        <label className={label}>
          Name
          <input
            name="name"
            required
            maxLength={FIELD_MAX.lecturerName}
            defaultValue={lecturer?.name}
            autoComplete="off"
            className={input}
            lang="pl"
          />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <label className={label}>
          Email
          <input
            name="email"
            inputMode="email"
            maxLength={FIELD_MAX.email}
            defaultValue={lecturer?.email ?? ''}
            autoComplete="off"
            spellCheck={false}
            className={input}
          />
        </label>
        <label className={label}>
          Room
          <input
            name="room"
            maxLength={FIELD_MAX.room}
            defaultValue={lecturer?.room ?? ''}
            autoComplete="off"
            className={input}
          />
        </label>
      </div>
      <label className={label}>
        Office hours
        <input
          name="officeHours"
          maxLength={FIELD_MAX.officeHours}
          defaultValue={lecturer?.officeHours ?? ''}
          autoComplete="off"
          className={input}
          lang="pl"
        />
      </label>
      {!add && (
        <span className={`${hint} -mt-1.5`}>
          Leave a field empty to remove it.
        </span>
      )}
    </ActionForm>
  );
}
