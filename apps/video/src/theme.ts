import { loadFont } from '@remotion/google-fonts/Geist';
import { loadFont as loadMono } from '@remotion/google-fonts/GeistMono';

// The web app's typeface (Geist) and accent (#235a81, app/globals.css).
export const { fontFamily } = loadFont('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin', 'latin-ext'],
});
export const { fontFamily: monoFamily } = loadMono('normal', {
  weights: ['400', '500'],
  subsets: ['latin', 'latin-ext'],
});

export const colors = {
  bg: '#f4f4f5',
  ink: '#18181b',
  muted: '#52525b',
  accent: '#235a81',
  highlight: '#f59e0b',
  panel: '#ffffff',
  line: '#e4e4e7',
};

/** Screenshot space: every desktop capture is 1920x1080. */
export const SHOT = { width: 1920, height: 1080 };
