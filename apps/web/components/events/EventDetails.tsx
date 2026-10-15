import type { AuditRow } from '@studies/db';
import { EVENT_KINDS } from '@studies/db/constants';
import { FileList } from '@/components/simple/FileList';
import type { LinkedTopic } from '@/lib/event-queries';
import { AUDIT_LABELS, auditSummary, whenLabel } from '@/lib/event-view';
import { formatDate } from '@/lib/format';
import { isoFiles } from '@/lib/simple-page';
import type { SimpleFile } from '@/lib/simple-queries';
import { EventButtons } from './EventButtons';
import { LinkedPosts } from './LinkedPosts';

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
  createdByName: string | null;
  updatedByName: string | null;
  deleted: boolean;
  postLine: string;
  files: SimpleFile[];
  linked: LinkedTopic[];
  history: AuditRow[];
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
}: {
  e: EventPageData;
  base: 'simple' | 'advanced';
  baseHref: string;
  editHref: string;
  selectedFileId: number | null;
  canRestore: boolean;
}) {
  const kind = EVENT_KINDS[e.kind];
  const rows: [string, string][] = [
    ['Kiedy', whenLabel(e.startsAt, e.endsAt, e.allDay)],
  ];
  if (e.subjectCode)
    rows.push(['Przedmiot', `${e.subjectCode} · ${e.subjectName}`]);
  if (e.place) rows.push(['Miejsce', e.place]);
  if (e.createdByName) rows.push(['Dodał(a)', e.createdByName]);
  if (e.updatedByName && e.updatedByName !== e.createdByName) {
    rows.push(['Ostatnio zmienił(a)', e.updatedByName]);
  }
  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="self-start rounded bg-box-head px-1.5 py-0.5 text-xs font-semibold text-accent-ink">
          <span aria-hidden>{kind.symbol} </span>
          {kind.label}
        </span>
        <h1 className="mt-1 mb-0 text-[22px] font-semibold tracking-[-0.01em] text-balance">
          {e.title}
        </h1>
      </div>
      {e.deleted && (
        <div
          role="status"
          className="rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
        >
          Wydarzenie usunięte
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
      <p className="m-0 text-muted">{e.postLine}</p>
      {(!e.deleted || canRestore) && (
        <EventButtons
          id={e.id}
          base={base}
          editHref={editHref}
          deleted={e.deleted}
        />
      )}
      <h2 className={h2}>Materiały</h2>
      <FileList
        files={isoFiles(e.files)}
        withSubject={!e.subjectId}
        selectedId={selectedFileId}
        baseHref={baseHref}
        emptyText="Brak materiałów. Pojawią się po powiązaniu postów z plikami."
      />
      {!e.deleted && (
        <>
          <h2 className={h2}>Powiąż posty</h2>
          <LinkedPosts
            eventId={e.id}
            subjectId={e.subjectId}
            linked={e.linked}
          />
        </>
      )}
      {e.deleted && e.linked.length > 0 && (
        <>
          <h2 className={h2}>Powiązane posty</h2>
          <ul className="m-0 pl-5">
            {e.linked.map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
        </>
      )}
      <h2 className={h2}>Historia</h2>
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
