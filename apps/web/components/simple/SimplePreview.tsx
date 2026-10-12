'use client';

import {
  ArrowsOut,
  DownloadSimple,
  File,
  FileImage,
  FilePdf,
  FileText,
  X,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FilePreview } from '@/components/FilePreview';
import { formatDate, formatSize } from '@/lib/format';
import type { PreviewFile } from '@/lib/queries';
import { statusBadge } from '@/lib/simple';

const KIND_ICON = {
  pdf: FilePdf,
  image: FileImage,
  text: FileText,
  none: File,
} as const;

const BADGE = {
  warn: 'border-warn-fg text-warn-fg',
  err: 'border-err-fg text-err-fg',
} as const;

/**
 * Simple-mode preview panel (design: 360px right column; full-screen sheet
 * below lg). Same real preview as the advanced PreviewPanel (`FilePreview`:
 * PDF viewer, image, text), laid out per the simple design: Pobierz as the
 * primary action, Pełny ekran, status badge, preview, then the meta table
 * Przedmiot / Zajęcia / Rozmiar / Dodał(a) / Dodano. `meta.subjectName` is
 * the subject's full name (PreviewFile only carries the code). Escape
 * (outside form fields) and × navigate to `closeHref`.
 */
export function SimplePreview({
  file,
  closeHref,
  meta,
}: {
  file: PreviewFile | null;
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

  const Icon = KIND_ICON[file?.previewKind ?? 'none'];
  const ready = file?.status === 'ready' && file.previewKind !== 'none';
  const badge = file ? statusBadge(file.status) : null;
  const rows: [string, string][] = file
    ? [
        ['Przedmiot', meta.subjectName],
        [
          'Zajęcia',
          [file.className, file.groupName].filter(Boolean).join(', ') || '-',
        ],
        ['Rozmiar', formatSize(file.sizeBytes)],
        ['Dodał(a)', file.uploader],
        ['Dodano', formatDate(file.createdAt)],
      ]
    : [];

  return (
    <aside
      aria-label="Podgląd pliku"
      className="panel-in fixed inset-0 z-40 flex flex-col overflow-y-auto bg-page lg:static lg:z-auto lg:w-[360px] lg:shrink-0 lg:border-l lg:border-line-strong"
    >
      <div className="sticky top-0 z-[1] flex h-11 shrink-0 items-center justify-between border-b border-line-strong bg-surface pr-2 pl-3.5">
        <h2 className="m-0 flex items-center gap-1.5 text-[14px] font-semibold">
          <Icon size={16} className="text-accent-ink" aria-hidden />
          Podgląd pliku
        </h2>
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Zamknij podgląd"
          title="Zamknij podgląd (Esc)"
          className="grid size-8 place-items-center rounded-md text-muted hover:bg-line hover:text-fg"
        >
          <X size={16} aria-hidden />
        </Link>
      </div>
      {file ? (
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
              Pobierz
            </a>
            {ready && (
              <a
                href={`/files/${file.id}/preview`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-3 py-2 text-accent-ink transition-colors duration-100 hover:border-accent active:translate-y-px"
              >
                <ArrowsOut size={16} aria-hidden />
                Pełny ekran
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
              <Icon size={32} aria-hidden />
              <span>
                {file.status === 'pending'
                  ? 'Podgląd pojawi się po przetworzeniu pliku'
                  : file.status === 'failed'
                    ? 'Podgląd niedostępny'
                    : 'Brak podglądu dla tego typu pliku'}
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
      ) : (
        <div className="flex flex-col gap-1 p-3.5">
          <div className="text-[15px] font-semibold">Plik został usunięty</div>
          <p className="m-0 text-muted">
            Ten plik nie jest już dostępny. Wybierz inny z listy.
          </p>
        </div>
      )}
    </aside>
  );
}
