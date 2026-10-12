import { getRoPool } from '@/lib/db';
import { roErrorMessage } from '@/lib/db-errors';
import { listMyGroupOptions } from '@/lib/plan-queries';
import { MyGroupsForm } from './MyGroupsForm';

export const errBox =
  'rounded-md border border-err-line bg-err-bg px-3 py-2 text-err-fg';

/** "Moje grupy" tab of the plan; `weekHref` is the week view of the same mode. */
export async function GroupsTab({ weekHref }: { weekHref: string }) {
  try {
    const options = await listMyGroupOptions(getRoPool());
    return <MyGroupsForm options={options} weekHref={weekHref} />;
  } catch (err) {
    return (
      <div role="alert" className={errBox}>
        Nie udało się wczytać zajęć: {roErrorMessage(err)}
      </div>
    );
  }
}
