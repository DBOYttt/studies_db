import type { AuditRow } from '@studies/db';
import Link from 'next/link';
import {
  auditActionLabel,
  auditDetails,
  formatAuditTime,
} from '@/lib/admin-audit';
import type { AuditTarget } from '@/lib/admin-audit-targets';

const th =
  'sticky top-0 z-[1] whitespace-nowrap border-b border-l border-b-line-strong border-l-line bg-surface px-2.5 py-[7px] text-left font-sans font-semibold first:border-l-0';
const td = 'border-b border-l border-line px-2.5 py-[5px] first:border-l-0';

/**
 * Action as a small square label in plain words ("Entry quiz turned on"),
 * with the stored key (`class_mark.add`) in the tooltip; rejected
 * statements read as errors.
 */
export function AuditActionLabel({ action }: { action: string }) {
  const rejected = action === 'sql.rejected';
  return (
    <span
      title={action}
      className={`inline-block rounded border px-1.5 font-mono text-[11.5px] ${
        rejected
          ? 'border-err-line bg-err-bg text-err-fg'
          : 'border-line-strong bg-page text-accent-ink'
      }`}
    >
      {auditActionLabel(action)}
    </span>
  );
}

/** `15 Jan 2026, 12:05:09 CET` as date and time that wrap as a whole. */
function AuditTime({ at }: { at: Date }) {
  const [day, time] = formatAuditTime(at).split(', ');
  return (
    <>
      <span className="whitespace-nowrap">{day},</span>{' '}
      <span className="whitespace-nowrap">{time}</span>
    </>
  );
}

/**
 * Audit log rows (Overview and Audit log): time, user, action, target
 * (named and linked where `targets` knows it), rows, details.
 */
export function AuditTable({
  rows,
  targets,
  emptyText,
}: {
  rows: AuditRow[];
  /** From loadAuditTargets, by audit row id. */
  targets?: Map<number, AuditTarget>;
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
              User
            </th>
            <th scope="col" className={th}>
              Action
            </th>
            <th scope="col" className={th}>
              Target
            </th>
            <th scope="col" className={`${th} text-right`}>
              Rows
            </th>
            <th scope="col" className={th}>
              Details
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const target = targets?.get(r.id);
            const details = auditDetails(r);
            return (
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
                <td className={`${td} tabular-nums`}>
                  <AuditTime at={r.createdAt} />
                </td>
                <td className={`${td} font-sans`}>{r.userName}</td>
                <td className={td}>
                  <AuditActionLabel action={r.action} />
                </td>
                <td className={`${td} font-sans`}>
                  {target?.href ? (
                    <Link
                      href={target.href}
                      title={r.target ?? undefined}
                      className="text-accent-ink hover:text-accent-ink-hover hover:underline"
                    >
                      {target.label}
                    </Link>
                  ) : target ? (
                    <span title={r.target ?? undefined}>{target.label}</span>
                  ) : (
                    (r.target ?? <span className="text-faint">—</span>)
                  )}
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {r.rowsAffected ?? <span className="text-faint">—</span>}
                </td>
                <td className={`${td} min-w-[220px]`}>
                  {details ? (
                    <Link
                      href={`/admin/audit/${r.id}`}
                      title={r.statement ?? undefined}
                      className={`${r.statement ? 'break-all' : 'font-sans break-words'} text-fg hover:text-accent-ink-hover hover:underline`}
                    >
                      {details}
                    </Link>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
