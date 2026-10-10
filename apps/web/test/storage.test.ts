import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { storageDir } from '../lib/storage';

afterEach(() => vi.unstubAllEnvs());

it('resolves relative STORAGE_DIR against the repo root', () => {
  vi.stubEnv('STORAGE_DIR', './storage');
  expect(storageDir()).toBe(
    resolve(fileURLToPath(new URL('../../..', import.meta.url)), 'storage'),
  );
});

it('passes absolute STORAGE_DIR through', () => {
  vi.stubEnv('STORAGE_DIR', '/srv/x');
  expect(storageDir()).toBe('/srv/x');
});

it('throws on relative STORAGE_DIR in production', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('STORAGE_DIR', './storage');
  expect(() => storageDir()).toThrow(/absolute/);
});

it('allows absolute STORAGE_DIR in production', () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('STORAGE_DIR', '/data/storage');
  expect(storageDir()).toBe('/data/storage');
});
