'use client';

import { BellRinging } from '@phosphor-icons/react';
import { useState } from 'react';
import { saveRemindersAction } from '@/lib/my-groups-actions';

/**
 * "Reminders": DM reminders 24 h and 1 h before events. Each checkbox is
 * saved at once (a rejected save reverts it); the choice is shared with the
 * Discord panel.
 */
export function RemindersForm({
  dayBefore,
  hourBefore,
  disabledReason,
}: {
  dayBefore: boolean;
  hourBefore: boolean;
  disabledReason: string | null;
}) {
  const [on, setOn] = useState({ day: dayBefore, hour: hourBefore });
  const [reason, setReason] = useState(disabledReason);
  const [failed, setFailed] = useState(false);

  const toggle = (which: 'day' | 'hour') => {
    const before = on;
    const next = { ...on, [which]: !on[which] };
    setOn(next);
    setFailed(false);
    const revert = () => {
      setOn(before);
      setFailed(true);
    };
    saveRemindersAction(next.day, next.hour).then((r) => {
      if (r.ok) setReason(null);
      else revert();
    }, revert);
  };

  const row = 'flex items-center gap-2 border-b border-line px-3 py-2';
  return (
    <section
      aria-labelledby="reminders-title"
      className="mt-3 max-w-3xl overflow-hidden rounded-md border border-line-strong"
    >
      <div className="flex items-center gap-1.5 border-b border-line-strong bg-box-head px-3 py-[7px]">
        <BellRinging size={15} className="text-accent-ink" aria-hidden />
        <h2 id="reminders-title" className="m-0 text-[13px] font-semibold">
          Reminders
        </h2>
      </div>
      <p className="m-0 border-b border-line px-3 py-2 text-muted">
        A Discord direct message before events of your groups.
      </p>
      {reason && (
        <p
          role="status"
          className="m-0 border-b border-line px-3 py-2 text-err-fg"
        >
          Reminders turned off: {reason}. Enable direct messages and set them up
          again.
        </p>
      )}
      <label className={row}>
        <input
          type="checkbox"
          checked={on.day}
          onChange={() => toggle('day')}
        />
        24 h before
      </label>
      <label className={row}>
        <input
          type="checkbox"
          checked={on.hour}
          onChange={() => toggle('hour')}
        />
        1 h before
      </label>
      {failed && (
        <p role="alert" className="m-0 px-3 py-2 text-err-fg">
          Could not save. Try again.
        </p>
      )}
    </section>
  );
}
