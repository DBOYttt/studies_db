import { describe, expect, it } from 'vitest';
import manifest from '../app/manifest';

describe('web app manifest', () => {
  it('describes the installable app', () => {
    expect(manifest()).toEqual({
      name: 'Studies DB',
      short_name: 'Studies DB',
      description: 'Materials, timetable and events of your year.',
      start_url: '/',
      scope: '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: '#235a81',
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
    });
  });
});
