import { getMyGroups, getReminderPrefs } from '@studies/db';
import { getDb, getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { listMyGroupOptions } from '@/lib/plan-queries';
import { requireUser } from '@/lib/session';
import { GroupImport } from './GroupImport';
import { MyGroupsForm } from './MyGroupsForm';
import { MyGroupsImport } from './MyGroupsImport';
import { RemindersForm } from './RemindersForm';

export const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';

/** "My groups" tab of the timetable; `weekHref` is the week view of the same mode. */
export async function GroupsTab({ weekHref }: { weekHref: string }) {
  const user = await requireUser();
  try {
    const [options, stored, reminders] = await Promise.all([
      listMyGroupOptions(getRoPool()),
      getMyGroups(getDb(), user.id),
      getReminderPrefs(getDb(), user.id),
    ]);
    return (
      <>
        <MyGroupsImport hasStored={Object.keys(stored).length > 0} />
        <GroupImport
          groupNames={Object.fromEntries(
            options.flatMap((o) => o.groups.map((g) => [g.id, g.name])),
          )}
        />
        {/* remount when an import fills the saved choice */}
        <MyGroupsForm
          key={JSON.stringify(stored)}
          options={options}
          initialGroups={stored}
          weekHref={weekHref}
        />
        <RemindersForm
          dayBefore={reminders.dayBefore}
          hourBefore={reminders.hourBefore}
          disabledReason={reminders.disabledReason}
        />
      </>
    );
  } catch (err) {
    return (
      <div role="alert" className={errBox}>
        Could not load the classes: {roErrorMessage(err)}
      </div>
    );
  }
}
