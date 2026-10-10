'use client';

import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Static copy made by scripts/copy-pdf-worker.mjs (see next.config.ts: webpack's
// `new URL(..., import.meta.url)` handling is disabled globally).
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

export default function PdfViewer({ src }: { src: string }) {
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Nie udało się wczytać podglądu PDF.
      </p>
    );
  }
  const btn =
    'rounded border border-[var(--border)] px-2 py-1 disabled:opacity-40';
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className={btn}
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          ‹ Poprzednia
        </button>
        <span>
          Strona {page} / {pages || '…'}
        </span>
        <button
          type="button"
          className={btn}
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          Następna ›
        </button>
        <span className="mx-2 text-[var(--muted)]">|</span>
        <button
          type="button"
          className={btn}
          aria-label="Pomniejsz"
          onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
        >
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className={btn}
          aria-label="Powiększ"
          onClick={() => setZoom(Math.min(3, zoom + 0.25))}
        >
          +
        </button>
      </div>
      <div className="max-h-[80vh] overflow-auto rounded border border-[var(--border)] bg-neutral-200 p-2 dark:bg-neutral-800">
        <Document
          file={src}
          loading="Wczytywanie PDF…"
          onLoadSuccess={(d) => setPages(d.numPages)}
          onLoadError={() => setError(true)}
          className="flex justify-center"
        >
          <Page pageNumber={page} scale={zoom} width={720} />
        </Document>
      </div>
    </div>
  );
}
