import {
  DownloadSimple,
  Eye,
  FolderDashed,
} from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import { formatDate, formatSize } from '@/lib/format';
import { fileIcon, highlightParts, statusBadge, withParam } from '@/lib/simple';
import type { SimpleFile } from '@/lib/simple-queries';
import { FileTypeIcon, TONE } from './FileTypeIcon';

/** A SimpleFile as it crosses into rendering: dates may be ISO strings. */
export type FileRowData = Omit<SimpleFile, 'createdAt'> & {
  createdAt: Date | string;
};

const BADGE = {
  warn: 'border-warn-fg text-warn-fg',
  err: 'border-err-fg text-err-fg',
} as const;

const btn =
  'inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-page px-3 text-accent-ink transition-colors duration-100 hover:border-accent active:translate-y-px max-sm:px-2.5';

function Marked({ text, q }: { text: string; q?: string }) {
  if (!q) return text;
  return highlightParts(text, q).map((p, i) =>
    // biome-ignore lint/suspicious/noArrayIndexKey: parts are positional
    p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>,
  );
}

export function FileRow({
  file: f,
  withSubject,
  selected,
  baseHref,
  q,
}: {
  file: FileRowData;
  withSubject: boolean;
  selected: boolean;
  baseHref: string;
  q?: string;
}) {
  const { tone } = fileIcon(f);
  const badge = statusBadge(f.status);
  const href = withParam(baseHref, 'file', f.id);
  const meta = [
    withSubject ? f.subjectName : null,
    [f.className, f.groupName].filter(Boolean).join(', ') || null,
    `added by ${f.uploader}`,
    formatDate(f.createdAt),
    formatSize(f.sizeBytes),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <li
      className={`flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-100 max-sm:flex-wrap ${
        selected ? 'bg-selected' : 'bg-panel hover:bg-list-hover'
      }`}
    >
      <span
        className={`grid size-[38px] shrink-0 place-items-center self-start rounded-md bg-surface sm:self-center ${TONE[tone]}`}
      >
        <FileTypeIcon file={f} size={21} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link
            href={href}
            scroll={false}
            aria-current={selected ? 'true' : undefined}
            className="font-semibold break-all text-accent-ink hover:text-accent-ink-hover hover:underline"
          >
            <Marked text={f.filename} q={q} />
          </Link>
          {badge && (
            <span
              className={`rounded-full border px-2 text-xs ${BADGE[badge.tone]}`}
            >
              {badge.label}
            </span>
          )}
        </div>
        <div className="break-words text-fg/80">
          <Marked text={f.topicTitle} q={q} />
        </div>
        <div className="text-xs text-faint">{meta}</div>
      </div>
      <div className="flex shrink-0 gap-1.5 max-sm:w-full max-sm:pl-[50px]">
        <Link
          href={href}
          scroll={false}
          aria-label={`Preview file ${f.filename}`}
          className={btn}
        >
          <Eye size={15} aria-hidden />
          Preview
        </Link>
        <a
          href={`/files/${f.id}/original`}
          aria-label={`Download file ${f.filename}`}
          className={btn}
        >
          <DownloadSimple size={15} aria-hidden />
          Download
        </a>
      </div>
    </li>
  );
}

/**
 * File rows of every simple list (design: icon tile, name → preview, badge,
 * topic, meta, Preview / Download). Preview links are `baseHref` + `file=<id>`;
 * `q` highlights hits in filename and topic; `empty` is shown for no rows.
 */
export function FileList({
  files,
  withSubject,
  selectedId,
  baseHref,
  q,
  emptyText = 'No files.',
  emptyAction,
}: {
  files: FileRowData[];
  withSubject: boolean;
  selectedId: number | null;
  baseHref: string;
  q?: string;
  emptyText?: string;
  emptyAction?: { label: string; href: string };
}) {
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-line-strong bg-panel px-4 py-8 text-center text-muted">
        <FolderDashed size={28} className="text-subtle" aria-hidden />
        <span>{emptyText}</span>
        {emptyAction && (
          <Link href={emptyAction.href} className="link">
            {emptyAction.label}
          </Link>
        )}
      </div>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col divide-y divide-line overflow-hidden rounded-lg border border-line-strong p-0">
      {files.map((f) => (
        <FileRow
          key={f.id}
          file={f}
          withSubject={withSubject}
          selected={f.id === selectedId}
          baseHref={baseHref}
          q={q}
        />
      ))}
    </ul>
  );
}
