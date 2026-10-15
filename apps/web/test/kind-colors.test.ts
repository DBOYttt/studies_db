import { readFileSync } from 'node:fs';
import { CLASS_KINDS, KIND_COLORS } from '@studies/db/constants';
import { describe, expect, it } from 'vitest';

/**
 * globals.css is the source of the web's class-kind colours; the bot's plan
 * image reads KIND_COLORS. They must not drift apart.
 */
const css = readFileSync(
  new URL('../app/globals.css', import.meta.url),
  'utf8',
);

/** `--kind-<kind>-<bg|fg>` values of one CSS block. */
function kindVars(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of block.matchAll(
    /--kind-([a-z]+)-(bg|fg):\s*(#[0-9a-f]{6})/gi,
  )) {
    out[`${m[1]}-${m[2]}`] = m[3].toLowerCase();
  }
  return out;
}

const darkStart = css.indexOf('@media (prefers-color-scheme: dark)');
const light = kindVars(css.slice(0, darkStart));
const dark = kindVars(css.slice(darkStart, css.indexOf('@theme')));

const expected = (theme: 'light' | 'dark') =>
  Object.fromEntries(
    CLASS_KINDS.flatMap((k) => [
      [`${k}-bg`, KIND_COLORS[theme][k].bg],
      [`${k}-fg`, KIND_COLORS[theme][k].fg],
    ]),
  );

describe('KIND_COLORS', () => {
  it('has a light and a dark pair for every class kind in globals.css', () => {
    expect(Object.keys(light)).toHaveLength(CLASS_KINDS.length * 2);
    expect(Object.keys(dark)).toHaveLength(CLASS_KINDS.length * 2);
  });
  it('equals the light values of globals.css', () => {
    expect(light).toEqual(expected('light'));
  });
  it('equals the dark values of globals.css', () => {
    expect(dark).toEqual(expected('dark'));
  });
});
