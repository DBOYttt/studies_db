'use client';

import { ArrowsOut, DownloadSimple, X } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FilePreview } from '@/components/FilePreview';
import { formatDate, formatSize } from '@/lib/format';
import type { PreviewFile } from '@/lib/queries';
import { statusBadge } from '@/lib/simple';
import { FileTypeIcon } from './FileTypeIcon';

const BADGE = {
  warn: 'border-warn-fg text-warn-fg',
  err: 'border-err-fg text-err-fg',
} as const;

/**
 * Simple-mode preview panel (design: 360px right column; full-screen sheet
 * below lg). Same real preview as the advanced PreviewPanel (`FilePreview`:
 * PDF viewer, image, text), laid out per the simple design: Download as the
 * primary action, Full screen, status badge, preview, then the meta table
 * Subject / Class / Size / Added by / Added. `meta.subjectName` is
 * the subject's full name (PreviewFile only carries the code). Escape
 * (outside form fields) and × navigate to `closeHref`.
 */
export function SimplePreview({
  file,
  closeHref,
  meta,
}: {
  file: PreviewFile;
  closeHref: string;
  meta: { subjectName: string };
}) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || t.closest('input, textarea, select'))
      )
        return;
      router.push(closeHref, { scroll: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, closeHref]);

  const ready = file.status === 'ready' && file.previewKind !== 'none';
  const badge = statusBadge(file.status);
  const rows: [string, string][] = [
    ['Subject', meta.subjectName],
    [
      'Class',
      [file.className, file.groupName].filter(Boolean).join(', ') || '-',
    ],
    ['Size', formatSize(file.sizeBytes)],
    ['Added by', file.uploader],
    ['Added', formatDate(file.createdAt)],
  ];

  return (
    <aside
      aria-label="File preview"
      className="panel-in fixed inset-0 z-40 flex flex-col overflow-y-auto bg-page lg:static lg:z-auto lg:w-[360px] lg:shrink-0 lg:border-l lg:border-line-strong"
    >
      <div className="sticky top-0 z-[1] flex h-11 shrink-0 items-center justify-between border-b border-line-strong bg-surface pr-2 pl-3.5">
        <h2 className="m-0 flex items-center gap-1.5 text-[14px] font-semibold">
          <FileTypeIcon file={file} size={16} toned />
          File preview
        </h2>
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Close preview"
          title="Close preview (Esc)"
          className="grid size-8 place-items-center rounded-md text-muted hover:bg-line hover:text-fg"
        >
          <X size={16} aria-hidden />
        </Link>
      </div>
      <div className="flex flex-col gap-3.5 p-3.5">
        <div>
          <div className="text-[15px] font-semibold break-all">
            {file.filename}
          </div>
          <div className="break-words text-muted">{file.topicTitle}</div>
        </div>
        <div className="flex gap-1.5">
          <a
            href={`/files/${file.id}/original`}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent-fill px-3 py-2 font-semibold text-on-accent transition-colors duration-100 hover:bg-accent-fill-hover active:translate-y-px"
          >
            <DownloadSimple size={16} aria-hidden />
            Download
          </a>
          {ready && (
            <a
              href={`/files/${file.id}/preview`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-2 text-accent-ink transition-colors duration-100 hover:border-accent active:translate-y-px"
            >
              <ArrowsOut size={16} aria-hidden />
              Full screen
            </a>
          )}
        </div>
        {badge && (
          <span
            className={`self-start rounded-full border px-2 py-px text-xs ${BADGE[badge.tone]}`}
          >
            {badge.label}
          </span>
        )}
        {ready ? (
          <FilePreview
            key={file.id}
            id={file.id}
            kind={file.previewKind}
            filename={file.filename}
            defaultOpen
          />
        ) : (
          <div className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong bg-zebra px-4 text-center text-faint">
            <FileTypeIcon file={file} size={32} />
            <span>
              {file.status === 'pending'
                ? 'The preview appears once the file is processed'
                : file.status === 'failed'
                  ? 'Preview unavailable'
                  : 'No preview for this file type'}
            </span>
          </div>
        )}
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            {rows.map(([k, v]) => (
              <tr key={k}>
                <th
                  scope="row"
                  className="w-24 py-1 text-left align-top font-normal text-muted"
                >
                  {k}
                </th>
                <td className="py-1 break-words">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
