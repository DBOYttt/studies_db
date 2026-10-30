'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { usePreviewWatchdog } from '@/lib/preview-watchdog';

const PdfViewer = dynamic(() => import('./PdfViewer'), {
  ssr: false,
  loading: () => (
    <p role="status" className="text-sm">
      Loading preview…
    </p>
  ),
});

const MAX_TEXT_CHARS = 200_000;

type Watch = { rendered: () => void; onError: () => void };

function TextPreview({ src, rendered, onError }: { src: string } & Watch) {
  const [text, setText] = useState<string | null>(null);
  // The callbacks change every render; the fetch runs once per file.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    let live = true;
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('http'))))
      .then((t) => {
        if (!live) return;
        setText(t.slice(0, MAX_TEXT_CHARS));
        rendered();
      })
      .catch(() => live && onError());
    return () => {
      live = false;
    };
  }, [src]);
  if (text === null)
    return (
      <p role="status" className="text-sm">
        Loading preview…
      </p>
    );
  return (
    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs">
      {text}
    </pre>
  );
}

/** Shown on a load error, or when nothing rendered within 15 s. */
function PreviewFailed({ id }: { id: number }) {
  return (
    <p role="alert" className="text-sm">
      Could not load the preview.{' '}
      <a href={`/files/${id}/original`} className="link">
        Download instead
      </a>
    </p>
  );
}

export function FilePreview({
  id,
  kind,
  filename,
  defaultOpen,
}: {
  id: number;
  kind: 'pdf' | 'image' | 'text' | 'none';
  filename: string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const src = `/files/${id}/preview`;
  const watch = usePreviewWatchdog(open && kind !== 'none' ? src : null);
  if (kind === 'none') {
    return (
      <p className="text-sm text-[var(--muted)]">
        This file type has no preview. Use “Download”.
      </p>
    );
  }
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-[var(--border)] px-3 py-1.5 text-sm"
      >
        Show preview
      </button>
    );
  }
  if (watch.failed) return <PreviewFailed id={id} />;
  if (kind === 'pdf')
    return (
      <PdfViewer
        src={src}
        onRendered={watch.rendered}
        onError={watch.onError}
      />
    );
  if (kind === 'text')
    return (
      <TextPreview
        src={src}
        rendered={watch.rendered}
        onError={watch.onError}
      />
    );
  return (
    // biome-ignore lint/performance/noImgElement: authenticated file route, not optimizable
    <img
      src={src}
      alt={filename}
      onLoad={watch.rendered}
      onError={watch.onError}
      className="max-h-[80vh] max-w-full rounded border border-[var(--border)]"
    />
  );
}
