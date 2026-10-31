'use client';

import { DownloadSimple, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { installMode, isIosSafari } from '@/lib/install-app';

/** Chromium's install offer (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chromium may offer install before React hydrates, so the event is kept
// at module level from the moment this chunk loads.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Running as the installed app (Android/desktop) or from the iOS home screen. */
export function runsStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

/** True after hydration, so server HTML and the first client render agree. */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

const BAR =
  'flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] font-medium text-accent-ink hover:bg-line max-sm:min-h-11 max-sm:min-w-11 max-sm:justify-center';
const PAGE =
  'flex w-fit items-center gap-1.5 rounded-md border border-line-strong px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-row-hover max-sm:min-h-11';

/**
 * "Install app": Chromium's install dialog where the browser offers one, the
 * Share → Add to Home Screen guide on iOS (no install API there), nothing in
 * the installed app or in browsers that cannot install.
 */
export function InstallAppButton({ variant }: { variant: 'bar' | 'page' }) {
  const mounted = useMounted();
  const prompt = useSyncExternalStore(
    subscribe,
    () => deferred,
    () => null,
  );
  const dialogRef = useRef<HTMLDialogElement>(null);
  if (!mounted) return null;
  const mode = installMode({
    ua: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints,
    standalone: runsStandalone(),
    hasPrompt: prompt !== null,
  });
  if (mode === 'hidden') return null;

  async function onClick() {
    if (mode === 'ios') {
      dialogRef.current?.showModal();
      return;
    }
    const e = deferred;
    if (!e) return;
    await e.prompt();
    // The event works once; Chromium fires a new one if install is still possible.
    deferred = null;
    notify();
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        className={variant === 'bar' ? BAR : PAGE}
        aria-haspopup={mode === 'ios' ? 'dialog' : undefined}
      >
        <DownloadSimple
          size={variant === 'bar' ? 15 : 16}
          weight="bold"
          aria-hidden
        />
        <span className={variant === 'bar' ? 'max-lg:sr-only' : undefined}>
          Install app
        </span>
      </button>
      {mode === 'ios' && <IosGuide ref={dialogRef} />}
    </>
  );
}

function IosGuide({ ref }: { ref: React.Ref<HTMLDialogElement> }) {
  const safari = isIosSafari(navigator.userAgent);
  return (
    <dialog
      ref={ref}
      aria-labelledby="install-guide-title"
      className="m-auto w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line-strong bg-surface p-5 text-left text-sm leading-relaxed text-fg backdrop:bg-black/40"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="install-guide-title" className="m-0 text-base font-semibold">
          Install Studies DB
        </h2>
        <form method="dialog">
          <button
            type="submit"
            aria-label="Close"
            className="grid size-8 place-items-center rounded text-muted hover:bg-line max-sm:size-11"
          >
            <X size={16} weight="bold" aria-hidden />
          </button>
        </form>
      </div>
      {safari ? (
        <ol className="mt-3 mb-0 flex list-decimal flex-col gap-1.5 pl-5">
          <li>Tap the Share button in the toolbar.</li>
          <li>Choose Add to Home Screen.</li>
          <li>Tap Add.</li>
        </ol>
      ) : (
        <p className="mt-3 mb-0">
          Open this page in Safari, then tap the Share button and choose Add to
          Home Screen.
        </p>
      )}
      <p className="mt-3 mb-0 text-muted">
        The app opens on its sign-in screen. Paste the link the bot sends you
        after /link there.
      </p>
    </dialog>
  );
}
