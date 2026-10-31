import type { MetadataRoute } from 'next';

export const THEME_COLOR = '#235a81';

/** Makes the site installable (Install app button, components/InstallAppButton.tsx). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Studies DB',
    short_name: 'Studies DB',
    description: 'Materials, timetable and events of your year.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: THEME_COLOR,
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
