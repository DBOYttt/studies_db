import type { AuditRow } from '@studies/db';
import Link from 'next/link';
import {
  AUDIT_ACTION_LABELS,
  type AuditAction,
  auditStatementPreview,
  formatAuditTime,
} from '@/lib/admin-audit';

const th =
  'sticky top-0 z-[1] whitespace-nowrap border-b border-l border-b-line-strong border-l-line bg-surface px-2.5 py-[7px] text-left font-sans font-semibold first:border-l-0';
const td = 'border-b border-l border-line px-2.5 py-[5px] first:border-l-0';

/** Action as a small square label; rejected statements read as errors. */
export function AuditActionLabel({ action }: { action: string }) {
  const rejected = action === 'sql.rejected';
  return (
    <span
      title={AUDIT_ACTION_LABELS[action as AuditAction] ?? action}
      className={`inline-block rounded border px-1.5 font-mono text-[11.5px] ${
        rejected
          ? 'border-err-line bg-err-bg text-err-fg'
          : 'border-line-strong bg-page text-accent-ink'
      }`}
    >
      {action}
    </span>
  );
}

/** Audit log rows (Overview and Audit log): time, admin, action, target, rows, statement. */
export function AuditTable({
  rows,
  emptyText,
}: {
  rows: AuditRow[];
  emptyText: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="m-0 rounded-md border border-line-strong px-3 py-6 text-center text-muted">
        {emptyText}
      </p>
    );
  }
  return (
    <div className="overflow-auto rounded-md border border-line-strong">
      <table className="w-full border-collapse font-mono text-[12.5px]">
        <thead>
          <tr>
            <th scope="col" className={th}>
              #
            </th>
            <th scope="col" className={th}>
              Time
            </th>
            <th scope="col" className={th}>
              Admin
            </th>
            <th scope="col" className={th}>
              Action
            </th>
            <th scope="col" className={th}>
              Table
            </th>
            <th scope="col" className={`${th} text-right`}>
              Rows
            </th>
            <th scope="col" className={th}>
              Statement
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={r.id}
              className={`${i % 2 ? 'bg-zebra' : ''} hover:bg-row-hover`}
            >
              <td className={td}>
                <Link
                  href={`/admin/audit/${r.id}`}
                  aria-label={`Entry ${r.id}`}
                  className="text-accent-ink hover:text-accent-ink-hover hover:underline"
                >
                  {r.id}
                </Link>
              </td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>
                {formatAuditTime(r.createdAt)}
              </td>
              <td className={`${td} whitespace-nowrap font-sans`}>
                {r.userName}
              </td>
              <td className={td}>
                <AuditActionLabel action={r.action} />
              </td>
              <td className={td}>
                {r.target ?? <span className="text-faint">—</span>}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {r.rowsAffected ?? <span className="text-faint">—</span>}
              </td>
              <td className={`${td} min-w-[280px]`}>
                <Link
                  href={`/admin/audit/${r.id}`}
                  title={r.statement ?? undefined}
                  className="break-all text-fg hover:text-accent-ink-hover hover:underline"
                >
                  {auditStatementPreview(r.statement)}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
