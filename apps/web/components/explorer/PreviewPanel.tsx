'use client';

import {
  ArrowsOut,
  DiscordLogo,
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

const KIND_ICON = {
  pdf: FilePdf,
  image: FileImage,
  text: FileText,
  none: File,
} as const;

const btn =
  'inline-flex items-center gap-[5px] rounded border border-line-strong px-2.5 py-[5px] text-accent-ink hover:border-accent';
const closeCls =
  'grid size-[26px] shrink-0 place-items-center rounded text-muted hover:bg-line hover:text-fg';

const BADGE = {
  pending: ['Przetwarzanie…', 'border-warn-fg text-warn-fg'],
  failed: ['Podgląd niedostępny', 'border-err-fg text-err-fg'],
} as const;

const MAX_MIME = 30;

/**
 * File preview aside (design 445-472): 360px column from lg (the caller sizes
 * it), full-screen sheet below. `file === null` means the requested file is
 * missing or deleted. Closing (×, Escape outside form fields) navigates to
 * `closeHref`, or calls `onClose` instead when given (client-side previews
 * such as the SQL console). `createdAt` may be an ISO string (JSON API).
 */
export function PreviewPanel({
  file,
  closeHref,
  onClose,
}:
  | { file: PreviewFile | null; closeHref: string; onClose?: undefined }
  | { file: PreviewFile | null; closeHref?: undefined; onClose: () => void }) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Escape inside a form field belongs to that field (e.g. clearing search).
      const t = e.target;
      if (
        t instanceof HTMLElement &&
        (t.isContentEditable || t.closest('input, textarea, select'))
      )
        return;
      if (onClose) onClose();
      else if (closeHref !== undefined)
        router.push(closeHref, { scroll: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, closeHref, onClose]);

  const Icon = KIND_ICON[file?.previewKind ?? 'none'];
  const canFullscreen =
    file && file.previewKind !== 'none' && file.status === 'ready';
  const meta: [string, string][] = file
    ? [
        ['Przedmiot', file.subjectCode],
        [
          'Zajęcia',
          [file.className, file.groupName].filter(Boolean).join(', ') || '—',
        ],
        ['Rozmiar', formatSize(file.sizeBytes)],
        ['Autor', file.uploader],
        ['Dodano', formatDate(file.createdAt)],
        [
          'MIME',
          file.mimeType.length > MAX_MIME
            ? `${file.mimeType.slice(0, MAX_MIME)}…`
            : file.mimeType,
        ],
      ]
    : [];
  const badge =
    file && file.status !== 'ready' ? BADGE[file.status] : undefined;
  const closeIcon = <X size={16} aria-hidden="true" />;

  return (
    <aside
      aria-label="Podgląd pliku"
      className="panel-in fixed inset-0 z-40 flex flex-col overflow-y-auto bg-page lg:static lg:z-auto lg:max-h-[calc(100dvh-4rem)] lg:rounded-md lg:border lg:border-line-strong"
    >
      <div className="sticky top-0 z-[1] flex h-[34px] shrink-0 items-center justify-between border-b border-line-strong bg-surface pr-2 pl-3">
        <h2 className="m-0 flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon size={15} className="text-accent-ink" aria-hidden="true" />
          Podgląd pliku
        </h2>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Zamknij podgląd"
            title="Zamknij podgląd (Esc)"
            className={closeCls}
          >
            {closeIcon}
          </button>
        ) : (
          <Link
            href={closeHref ?? '#'}
            scroll={false}
            aria-label="Zamknij podgląd"
            title="Zamknij podgląd (Esc)"
            className={closeCls}
          >
            {closeIcon}
          </Link>
        )}
      </div>
      {file ? (
        <div className="flex flex-col gap-3 p-3">
          <div>
            <div className="text-sm font-semibold break-all">
              {file.filename}
            </div>
            <div className="break-words text-muted">{file.topicTitle}</div>
          </div>
          <table className="w-full border-collapse text-xs">
            <tbody>
              {meta.map(([k, v]) => (
                <tr key={k}>
                  <th
                    scope="row"
                    className="w-24 py-[3px] text-left font-normal text-muted"
                  >
                    {k}
                  </th>
                  <td className="py-[3px] font-mono break-all">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-1.5">
            <a href={`/files/${file.id}/original`} className={btn}>
              <DownloadSimple size={14} aria-hidden="true" />
              Pobierz
            </a>
            {canFullscreen && (
              <a
                href={`/files/${file.id}/preview`}
                target="_blank"
                rel="noopener noreferrer"
                className={btn}
              >
                <ArrowsOut size={14} aria-hidden="true" />
                Pełny ekran
              </a>
            )}
            {file.discordUrl && (
              <a
                href={file.discordUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={btn}
              >
                <DiscordLogo size={14} aria-hidden="true" />
                Otwórz w Discordzie
              </a>
            )}
          </div>
          {badge && (
            <span
              className={`self-start rounded-full border px-2 py-px text-xs ${badge[1]}`}
            >
              {badge[0]}
            </span>
          )}
          {file.status === 'ready' && file.previewKind !== 'none' ? (
            <FilePreview
              key={file.id}
              id={file.id}
              kind={file.previewKind}
              filename={file.filename}
              defaultOpen
            />
          ) : (
            <div className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong bg-zebra text-faint">
              <Icon size={32} aria-hidden="true" />
              <span>
                {file.status === 'pending'
                  ? 'Podgląd pojawi się po przetworzeniu pliku'
                  : file.status === 'failed'
                    ? 'Podgląd niedostępny'
                    : 'Brak podglądu dla tego typu pliku'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-1 p-3">
          <div className="text-sm font-semibold">Plik został usunięty</div>
          <p className="m-0 text-muted">
            Ten plik nie jest już dostępny. Wybierz inny z listy.
          </p>
        </div>
      )}
    </aside>
  );
}
