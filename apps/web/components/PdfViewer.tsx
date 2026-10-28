'use client';

import { CaretLeft, CaretRight, Minus, Plus } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import { pdfWorkerFile } from '@/lib/cache-headers';

// Static copy made by scripts/copy-pdf-worker.mjs (see next.config.ts: webpack's
// `new URL(..., import.meta.url)` handling is disabled globally). Its name
// carries the pdf.js version, so it can be cached as immutable.
pdfjs.GlobalWorkerOptions.workerSrc = `/${pdfWorkerFile(pdfjs.version)}`;

const MAX_WIDTH = 1600;
const FALLBACK_WIDTH = 720;
const PADDING = 16; // p-2 on both sides of the scroll box

export default function PdfViewer({ src }: { src: string }) {
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () =>
      setContainerWidth(Math.max(0, Math.floor(el.clientWidth - PADDING)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the page to the container at 100%, then zoom from there.
  const width = Math.min(
    Math.round((containerWidth || FALLBACK_WIDTH) * zoom),
    MAX_WIDTH,
  );

  if (error) {
    return (
      <p className="text-sm text-red-600 dark:text-red-400">
        Could not load the PDF preview.
      </p>
    );
  }
  const btn =
    'inline-flex h-7 items-center gap-1 rounded border border-[var(--border)] px-2 disabled:opacity-40';
  return (
    <div className="space-y-2">
      {/* One row at every width: pages on the left, zoom on the right. */}
      <div
        data-testid="pdf-toolbar"
        className="flex flex-nowrap items-center justify-between gap-2 text-sm"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className={btn}
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <CaretLeft size={14} aria-hidden />
            <span aria-hidden className="max-sm:hidden">
              Previous
            </span>
          </button>
          <span className="whitespace-nowrap tabular-nums">
            Page {page} / {pages || '…'}
          </span>
          <button
            type="button"
            className={btn}
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            <span aria-hidden className="max-sm:hidden">
              Next
            </span>
            <CaretRight size={14} aria-hidden />
          </button>
        </div>
        <fieldset
          aria-label="Zoom"
          className="m-0 flex min-w-0 shrink-0 items-center gap-1 border-0 p-0"
        >
          <button
            type="button"
            className={btn}
            aria-label="Zoom out"
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
          >
            <Minus size={14} aria-hidden />
          </button>
          <span className="w-11 text-center tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            className={btn}
            aria-label="Zoom in"
            onClick={() => setZoom(Math.min(3, zoom + 0.25))}
          >
            <Plus size={14} aria-hidden />
          </button>
        </fieldset>
      </div>
      <div
        ref={boxRef}
        className="max-h-[80vh] overflow-auto rounded border border-[var(--border)] bg-neutral-200 p-2 dark:bg-neutral-800"
      >
        <Document
          file={src}
          loading="Loading PDF…"
          onLoadSuccess={(d) => setPages(d.numPages)}
          onLoadError={() => setError(true)}
          className="flex justify-center-safe"
        >
          <Page pageNumber={page} width={width} />
        </Document>
      </div>
    </div>
  );
}
