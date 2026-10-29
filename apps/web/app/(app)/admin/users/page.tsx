import { MagnifyingGlass, Users } from '@phosphor-icons/react/dist/ssr';
import { listUsersAdmin } from '@studies/db';
import Link from 'next/link';
import { ActionButton } from '@/components/admin/ActionButton';
import {
  box,
  boxHead,
  input,
  link,
  td,
  th,
} from '@/components/admin/form-styles';
import { ADMIN_CRUMB, adminTabs } from '@/components/shell/admin-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { setBanAction } from '@/lib/admin-actions';
import { parseUsersQuery, USERS_PAGE_SIZE, usersHref } from '@/lib/admin-pages';
import { getDb } from '@/lib/db';
import { formatDate, plural } from '@/lib/format';
import { requireAdmin } from '@/lib/session';
import { userHref } from '@/lib/view-links';

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

const pagerLink =
  'rounded border border-line-strong bg-bar px-2.5 py-1 text-accent-ink hover:bg-row-hover';
const pagerOff =
  'rounded border border-line bg-bar px-2.5 py-1 text-faint opacity-60';

/** /admin/users: search by name or Discord id, block or unblock access. */
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const me = await requireAdmin();
  const q = parseUsersQuery(await searchParams);
  const { rows, total } = await listUsersAdmin(getDb(), {
    q: q.q,
    limit: USERS_PAGE_SIZE,
    offset: (q.page - 1) * USERS_PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));

  return (
    <>
      <ScreenHeader
        crumbs={[ADMIN_CRUMB, { label: 'Users', href: '/admin/users' }]}
        tabs={adminTabs('users')}
      />
      <div className="flex max-w-[1200px] flex-col gap-4">
        <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">Users</h1>

        <search>
          <form
            action="/admin/users"
            className="flex max-w-xl flex-wrap items-end gap-2"
          >
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] font-semibold">
              Search users
              <input
                type="search"
                name="q"
                defaultValue={q.q}
                maxLength={100}
                placeholder="Name or Discord id"
                autoComplete="off"
                className={input}
              />
            </label>
            <button
              type="submit"
              className="inline-flex h-8 items-center gap-[5px] rounded border border-line-strong bg-panel px-2.5 text-accent-ink hover:border-accent"
            >
              <MagnifyingGlass size={14} aria-hidden />
              Search
            </button>
            {q.q && (
              <Link href="/admin/users" className={`${link} h-8 leading-8`}>
                Clear
              </Link>
            )}
          </form>
        </search>

        <section aria-labelledby="admin-users-list" className={box}>
          <div className={boxHead}>
            <Users size={15} className="text-accent-ink" aria-hidden />
            <h2 id="admin-users-list" className="m-0 text-[13px] font-semibold">
              {q.q ? `Users matching “${q.q}”` : 'All users'}
            </h2>
            <span className="ml-auto font-mono text-[11px] text-faint">
              {total}
            </span>
          </div>
          {rows.length === 0 ? (
            <p className="m-0 px-3 py-4 text-muted">
              {q.q ? 'No user matches this search.' : 'No users yet.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={th}>Name</th>
                    <th className={th}>Discord id</th>
                    <th className={th}>Role</th>
                    <th className={th}>Access</th>
                    <th className={th}>Joined</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((u, i) => (
                    <tr
                      key={u.id}
                      className={`hover:bg-row-hover ${i % 2 ? 'bg-zebra' : ''}`}
                    >
                      <td className={td}>
                        <Link href={userHref(u.id)} className={link}>
                          {u.displayName}
                        </Link>
                      </td>
                      <td className={`${td} font-mono text-xs text-muted`}>
                        {u.discordUserId}
                      </td>
                      <td className={td}>{u.isAdmin ? 'Admin' : 'Student'}</td>
                      <td className={td}>
                        {u.isBanned ? (
                          <span className="font-semibold text-err-fg">
                            Blocked
                          </span>
                        ) : (
                          <span className="text-ok-fg">Active</span>
                        )}
                      </td>
                      <td className={`${td} whitespace-nowrap tabular-nums`}>
                        {formatDate(u.createdAt)}
                      </td>
                      <td className={td}>
                        {u.id === me.id ? (
                          <span className="text-muted">This is you</span>
                        ) : (
                          <ActionButton
                            action={setBanAction}
                            fields={{
                              discordUserId: u.discordUserId,
                              banned: u.isBanned ? '0' : '1',
                            }}
                            label={u.isBanned ? 'Unblock' : 'Block'}
                            pendingLabel={
                              u.isBanned ? 'Unblocking…' : 'Blocking…'
                            }
                            confirm={
                              u.isBanned
                                ? {
                                    question: `Unblock ${u.displayName}?`,
                                    confirmLabel: 'Confirm unblock',
                                  }
                                : {
                                    question: `Block ${u.displayName}? They are signed out of the website.`,
                                    confirmLabel: 'Confirm block',
                                  }
                            }
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {pageCount > 1 && (
          <nav
            aria-label="Pages"
            className="flex flex-wrap items-center gap-2 text-[13px]"
          >
            {q.page > 1 ? (
              <Link
                href={usersHref({ ...q, page: q.page - 1 })}
                className={pagerLink}
              >
                Previous
              </Link>
            ) : (
              <span className={pagerOff}>Previous</span>
            )}
            <span className="text-muted">
              Page {q.page} of {pageCount} · {plural(total, 'user', 'users')}
            </span>
            {q.page < pageCount ? (
              <Link
                href={usersHref({ ...q, page: q.page + 1 })}
                className={pagerLink}
              >
                Next
              </Link>
            ) : (
              <span className={pagerOff}>Next</span>
            )}
          </nav>
        )}
      </div>
    </>
  );
}
