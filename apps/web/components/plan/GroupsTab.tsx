import { getMyGroups } from '@studies/db';
import { getDb, getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { listMyGroupOptions } from '@/lib/plan-queries';
import { requireUser } from '@/lib/session';
import { MyGroupsForm } from './MyGroupsForm';
import { MyGroupsImport } from './MyGroupsImport';

export const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';

/** "Moje grupy" tab of the plan; `weekHref` is the week view of the same mode. */
export async function GroupsTab({ weekHref }: { weekHref: string }) {
  try {
    const user = await requireUser();
    const [options, stored] = await Promise.all([
      listMyGroupOptions(getRoPool()),
      getMyGroups(getDb(), user.id),
    ]);
    return (
      <>
        {Object.keys(stored).length === 0 && <MyGroupsImport />}
        {/* remount when an import fills the saved choice */}
        <MyGroupsForm
          key={JSON.stringify(stored)}
          options={options}
          initialGroups={stored}
          weekHref={weekHref}
        />
      </>
    );
  } catch (err) {
    return (
      <div role="alert" className={errBox}>
        Nie udało się wczytać zajęć: {roErrorMessage(err)}
      </div>
    );
  }
}
