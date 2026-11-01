import { loadFont } from '@remotion/google-fonts/Geist';
import { loadFont as loadMono } from '@remotion/google-fonts/GeistMono';

// The web app's typeface (Geist) and its dark-theme accent ink (#84b9e2,
// app/globals.css); the screenshots are captured in the dark theme.
export const { fontFamily } = loadFont('normal', {
  weights: ['400', '500', '600', '700'],
  subsets: ['latin', 'latin-ext'],
});
export const { fontFamily: monoFamily } = loadMono('normal', {
  weights: ['400', '500'],
  subsets: ['latin', 'latin-ext'],
});

export const colors = {
  bg: '#111113',
  ink: '#fafafa',
  muted: '#a1a1aa',
  accent: '#84b9e2',
  highlight: '#f59e0b',
  panel: '#09090b',
  line: '#3f3f46',
};

/** Screenshot space: every desktop capture is 1920x1080. */
export const SHOT = { width: 1920, height: 1080 };
