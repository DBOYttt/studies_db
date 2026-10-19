import { afterEach, describe, expect, it, vi } from 'vitest';
import { isCrossOrigin } from '../lib/same-origin';

const req = (headers: Record<string, string> = {}) =>
  new Request('https://studies.example.com/api/x', { method: 'POST', headers });

describe('isCrossOrigin', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('a matching Origin is same-origin', () => {
    vi.stubEnv('WEB_BASE_URL', '');
    expect(isCrossOrigin(req({ origin: 'https://studies.example.com' }))).toBe(
      false,
    );
  });

  it('a foreign Origin is cross-origin', () => {
    vi.stubEnv('WEB_BASE_URL', '');
    expect(isCrossOrigin(req({ origin: 'https://evil.example' }))).toBe(true);
  });

  it('no Origin with Sec-Fetch-Site: same-origin is allowed', () => {
    expect(isCrossOrigin(req({ 'sec-fetch-site': 'same-origin' }))).toBe(false);
  });

  it('no Origin with Sec-Fetch-Site: cross-site is refused', () => {
    expect(isCrossOrigin(req({ 'sec-fetch-site': 'cross-site' }))).toBe(true);
  });

  it('neither header is refused', () => {
    expect(isCrossOrigin(req())).toBe(true);
  });
});
