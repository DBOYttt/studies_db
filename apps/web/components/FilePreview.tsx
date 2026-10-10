'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

const PdfViewer = dynamic(() => import('./PdfViewer'), {
  ssr: false,
  loading: () => <p className="text-sm">Wczytywanie podglądu…</p>,
});

const MAX_TEXT_CHARS = 200_000;

function TextPreview({ src }: { src: string }) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('http'))))
      .then((t) => live && setText(t.slice(0, MAX_TEXT_CHARS)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [src]);
  if (failed) return <p className="text-sm">Nie udało się wczytać podglądu.</p>;
  if (text === null) return <p className="text-sm">Wczytywanie podglądu…</p>;
  return (
    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] bg-[var(--surface)] p-3 font-mono text-xs">
      {text}
    </pre>
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
  if (kind === 'none') {
    return (
      <p className="text-sm text-[var(--muted)]">
        Ten typ pliku nie ma podglądu. Użyj „Pobierz”.
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
        Pokaż podgląd
      </button>
    );
  }
  if (kind === 'pdf') return <PdfViewer src={src} />;
  if (kind === 'text') return <TextPreview src={src} />;
  return (
    // biome-ignore lint/performance/noImgElement: authenticated file route, not optimizable
    <img
      src={src}
      alt={filename}
      className="max-h-[80vh] max-w-full rounded border border-[var(--border)]"
    />
  );
}
