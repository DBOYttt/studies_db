'use client';

import {
  ArrowsOut,
  DiscordLogo,
  DownloadSimple,
  X,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FilePreview } from '@/components/FilePreview';
import { StatusBadge } from '@/components/StatusBadge';
import { formatDate, formatSize } from '@/lib/format';
import type { ExplorerFile } from '@/lib/queries';

const btn =
  'inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm hover:border-accent';

/**
 * Right-hand preview. Side column from lg, full-screen sheet below.
 * `file === null` means the `file` param points at a missing or deleted file.
 */
export function PreviewPanel({
  file,
  closeHref,
}: {
  file: ExplorerFile | null;
  closeHref: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') router.push(closeHref);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, closeHref]);

  const canFullscreen =
    file && file.previewKind !== 'none' && file.status === 'ready';
  return (
    <aside
      aria-label="Podgląd pliku"
      className="panel-in fixed inset-0 z-40 flex flex-col overflow-y-auto bg-panel p-4 lg:static lg:z-auto lg:max-h-[calc(100dvh-2rem)] lg:rounded-xl lg:border lg:border-line"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          {file ? (
            <>
              <h2 className="break-all font-semibold">{file.filename}</h2>
              <p className="break-words text-sm text-muted">
                {file.topicTitle}
              </p>
            </>
          ) : (
            <h2 className="font-semibold">Plik został usunięty</h2>
          )}
        </div>
        <Link
          href={closeHref}
          aria-label="Zamknij podgląd"
          className="shrink-0 rounded-lg border border-line p-2 text-muted hover:border-accent hover:text-fg"
        >
          <X size={16} aria-hidden="true" />
        </Link>
      </div>
      {file ? (
        <div className="space-y-4">
          <p className="font-mono text-xs text-muted">
            {formatSize(file.sizeBytes)}, {file.uploader},{' '}
            {formatDate(file.createdAt)}
          </p>
          <div className="flex flex-wrap gap-2">
            <a href={`/files/${file.id}/original`} className={btn}>
              <DownloadSimple size={16} aria-hidden="true" />
              Pobierz
            </a>
            {canFullscreen && (
              <a
                href={`/files/${file.id}/preview`}
                target="_blank"
                rel="noopener noreferrer"
                className={btn}
              >
                <ArrowsOut size={16} aria-hidden="true" />
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
                <DiscordLogo size={16} aria-hidden="true" />
                Otwórz w Discordzie
              </a>
            )}
          </div>
          {file.status === 'ready' ? (
            <FilePreview
              key={file.id}
              id={file.id}
              kind={file.previewKind}
              filename={file.filename}
              defaultOpen
            />
          ) : (
            <StatusBadge status={file.status} />
          )}
        </div>
      ) : (
        <p className="text-sm text-muted">
          Ten plik nie jest już dostępny. Wybierz inny z listy.
        </p>
      )}
    </aside>
  );
}
