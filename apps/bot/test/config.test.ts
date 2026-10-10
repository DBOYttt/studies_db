import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('lists all missing vars', () => {
    expect(() => loadConfig({})).toThrow(
      'Missing env: DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, ADMIN_ROLE_ID, WEB_BASE_URL, DATABASE_URL, STORAGE_DIR',
    );
  });
  it('returns config when complete', () => {
    const c = loadConfig({
      DISCORD_TOKEN: 't',
      DISCORD_CLIENT_ID: 'c',
      DISCORD_GUILD_ID: 'g',
      ADMIN_ROLE_ID: 'a',
      WEB_BASE_URL: 'http://w',
      DATABASE_URL: 'mysql://d',
      STORAGE_DIR: '/s',
    });
    expect(c.storageDir).toBe('/s');
    expect(c.discordToken).toBe('t');
  });
});
