'use client';

/**
 * "Skip to content": the first tab stop of both shells, hidden until it has
 * focus. Enter moves focus to `<main id="content" tabIndex={-1}>` (without
 * adding `#content` to the URL), past the navigation panel.
 */
export function SkipLink() {
  return (
    // biome-ignore lint/a11y/useValidAnchor: a real in-page link (works without JS); the handler only keeps #content out of the URL
    <a
      href="#content"
      onClick={(e) => {
        const main = document.getElementById('content');
        if (!main) return;
        e.preventDefault();
        main.focus();
      }}
      className="fixed top-2 left-2 z-[60] -translate-y-[calc(100%+1rem)] rounded bg-accent-fill px-3 py-1.5 font-semibold text-on-accent focus:translate-y-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      Skip to content
    </a>
  );
}
