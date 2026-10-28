import type { AuditRow } from '@studies/db';
import { EVENT_KINDS } from '@studies/db/constants';
import { MONTHS_SHORT } from '@studies/db/text';
import { FileList } from '@/components/simple/FileList';
import type { LinkedTopic } from '@/lib/event-queries';
import { AUDIT_LABELS, auditSummary, whenLabel } from '@/lib/event-view';
import { formatDate } from '@/lib/format';
import { isoFiles } from '@/lib/simple-page';
import type { SimpleFile } from '@/lib/simple-queries';
import { EventButtons } from './EventButtons';
import { EventKindIcon } from './EventKindIcon';
import { EventUploads, type UploadItem } from './EventUploads';
import { LinkedPosts } from './LinkedPosts';
import { PostLine } from './PostLine';
import { SavedStatus } from './SavedStatus';

export type EventPageData = {
  id: number;
  kind: keyof typeof EVENT_KINDS;
  title: string;
  startsAt: Date;
  endsAt: Date | null;
  allDay: boolean;
  place: string | null;
  note: string | null;
  subjectId: number | null;
  subjectCode: string | null;
  subjectName: string | null;
  /** "Laboratorium", "Gr. 1" (content, Polish), or null. */
  className: string | null;
  groupName: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  /** Part of a series ("Part of a series"). */
  series: { rule: 'weekly' | 'biweekly'; until: string } | null;
  deleted: boolean;
  /** Only when the post failed or is missing; null hides the line. */
  postLine: string | null;
  /** The post failed or is missing: "Try again". */
  canRetryPost: boolean;
  version: number;
  files: SimpleFile[];
  linked: LinkedTopic[];
  history: AuditRow[];
  uploads: UploadItem[];
  /** Some failed upload still has its file: "Try again". */
  canRetryUploads: boolean;
};

const h2 = 'mt-3 mb-0 text-base font-semibold';

/** The event page body, shared by the simple and the advanced route. */
export function EventDetails({
  e,
  base,
  baseHref,
  editHref,
  selectedFileId,
  canRestore,
  savedText = null,
}: {
  e: EventPageData;
  base: 'simple' | 'advanced';
  baseHref: string;
  editHref: string;
  selectedFileId: number | null;
  canRestore: boolean;
  /** "Event added." / "Changes saved." right after the add / edit redirect. */
  savedText?: string | null;
}) {
  const kind = EVENT_KINDS[e.kind];
  const rows: [string, string][] = [
    ['When', whenLabel(e.startsAt, e.endsAt, e.allDay)],
  ];
  if (e.subjectCode)
    rows.push(['Subject', `${e.subjectCode} · ${e.subjectName}`]);
  if (e.className)
    rows.push([
      'Class',
      e.groupName ? `${e.className} ${e.groupName}` : e.className,
    ]);
  if (e.place) rows.push(['Place', e.place]);
  if (e.series) {
    const [y, m, d] = e.series.until.split('-').map(Number);
    rows.push([
      'Part of a series',
      `${e.series.rule === 'weekly' ? 'every week' : 'every 2 weeks'} until ${d} ${MONTHS_SHORT[m - 1]} ${y}`,
    ]);
  }
  if (e.createdByName) rows.push(['Added by', e.createdByName]);
  if (e.updatedByName && e.updatedByName !== e.createdByName) {
    rows.push(['Last changed by', e.updatedByName]);
  }
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="inline-flex items-center gap-1 self-start rounded bg-box-head px-1.5 py-0.5 text-xs font-semibold text-accent-ink">
          <EventKindIcon kind={e.kind} size={13} />
          {kind.label}
        </span>
        <h1 className="mt-1 mb-0 text-[22px] font-semibold tracking-[-0.01em] text-balance">
          {e.title}
        </h1>
      </div>
      <SavedStatus text={savedText} />
      {e.deleted && (
        <div
          role="status"
          className="rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
        >
          This event was deleted
        </div>
      )}
      <dl className="m-0 grid max-w-xl grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {e.note && (
        <p className="m-0 max-w-[65ch] whitespace-pre-line text-pretty text-muted">
          {e.note}
        </p>
      )}
      {e.postLine && (
        <PostLine eventId={e.id} text={e.postLine} canRetry={e.canRetryPost} />
      )}
      {(!e.deleted || canRestore) && (
        <EventButtons
          id={e.id}
          base={base}
          editHref={editHref}
          deleted={e.deleted}
          inSeries={e.series !== null}
          version={e.version}
        />
      )}
      <h2 className={h2}>Materials</h2>
      <FileList
        files={isoFiles(e.files)}
        withSubject={!e.subjectId}
        selectedId={selectedFileId}
        baseHref={baseHref}
        emptyText="No files yet. Add files below or link a post that has them."
      />
      {!e.deleted && (
        <>
          <h2 className={h2}>Add files</h2>
          <EventUploads
            eventId={e.id}
            initial={e.uploads}
            canRetry={e.canRetryUploads}
          />
          <h2 className={h2}>Link posts</h2>
          <LinkedPosts
            eventId={e.id}
            subjectId={e.subjectId}
            linked={e.linked}
          />
        </>
      )}
      {e.deleted && e.linked.length > 0 && (
        <>
          <h2 className={h2}>Linked posts</h2>
          <ul className="m-0 pl-5">
            {e.linked.map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
        </>
      )}
      <h2 className={h2}>History</h2>
      <ul className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-lg border border-line-strong p-0">
        {e.history.map((r) => (
          <li key={r.id} className="bg-panel px-3.5 py-2">
            <span className="font-semibold">
              {AUDIT_LABELS[r.action] ?? r.action}
            </span>{' '}
            <span className="text-muted">
              · {r.userName} · {formatDate(r.createdAt)}
            </span>
            {auditSummary(r.action, r.details) && (
              <div className="text-xs text-faint">
                {auditSummary(r.action, r.details)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
