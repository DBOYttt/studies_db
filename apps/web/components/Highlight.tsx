import { Fragment } from 'react';

/** Renders text where «match» becomes <mark>; never uses innerHTML. */
export function Highlight({ text }: { text: string }) {
  const parts = text.split(/([«»])/);
  const out: React.ReactNode[] = [];
  let inMark = false;
  let key = 0;
  for (const p of parts) {
    if (p === '«') inMark = true;
    else if (p === '»') inMark = false;
    else if (p) {
      out.push(
        inMark ? (
          <mark key={key++}>{p}</mark>
        ) : (
          <Fragment key={key++}>{p}</Fragment>
        ),
      );
    }
  }
  return <>{out}</>;
}
