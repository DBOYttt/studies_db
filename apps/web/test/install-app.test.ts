import { describe, expect, it } from 'vitest';
import {
  type InstallEnv,
  installMode,
  isIosSafari,
  MAX_TOKEN_LEN,
  parseSignInLink,
} from '../lib/install-app';

const UA = {
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0.6723.90 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/132.0 Mobile/15E148 Safari/605.1.15',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  desktopFirefox:
    'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
};

const env = (o: Partial<InstallEnv>): InstallEnv => ({
  ua: UA.androidChrome,
  maxTouchPoints: 0,
  standalone: false,
  hasPrompt: false,
  ...o,
});

describe('installMode', () => {
  it('prompt once Chromium offered install, hidden before', () => {
    expect(installMode(env({ hasPrompt: true }))).toBe('prompt');
    expect(installMode(env({}))).toBe('hidden');
  });

  it('ios for iPhone browsers and iPadOS with a desktop UA', () => {
    expect(installMode(env({ ua: UA.iphoneSafari, maxTouchPoints: 5 }))).toBe(
      'ios',
    );
    expect(installMode(env({ ua: UA.iphoneChrome, maxTouchPoints: 5 }))).toBe(
      'ios',
    );
    expect(installMode(env({ ua: UA.macSafari, maxTouchPoints: 5 }))).toBe(
      'ios',
    );
  });

  it('hidden on a Mac, desktop Firefox and when already installed', () => {
    expect(installMode(env({ ua: UA.macSafari }))).toBe('hidden');
    expect(installMode(env({ ua: UA.desktopFirefox }))).toBe('hidden');
    expect(installMode(env({ standalone: true, hasPrompt: true }))).toBe(
      'hidden',
    );
    expect(
      installMode(
        env({ ua: UA.iphoneSafari, maxTouchPoints: 5, standalone: true }),
      ),
    ).toBe('hidden');
  });
});

describe('isIosSafari', () => {
  it('only Safari itself', () => {
    expect(isIosSafari(UA.iphoneSafari)).toBe(true);
    expect(isIosSafari(UA.macSafari)).toBe(true); // iPadOS desktop UA
    expect(isIosSafari(UA.iphoneChrome)).toBe(false);
    expect(isIosSafari(UA.iphoneFirefox)).toBe(false);
  });
});

describe('parseSignInLink', () => {
  const O = 'https://studies.example';
  const T = 'aB3_-xYz09aB3_-xYz09aB3_-xYz09aB3_-xYz09aB3';

  it("accepts the bot's link, with or without next=/admin", () => {
    expect(parseSignInLink(`${O}/auth/callback?token=${T}`, O)).toBe(
      `/auth/callback?token=${T}`,
    );
    expect(
      parseSignInLink(`${O}/auth/callback?token=${T}&next=%2Fadmin`, O),
    ).toBe(`/auth/callback?token=${T}&next=%2Fadmin`);
  });

  it('accepts a bare token and Discord-wrapped or padded input', () => {
    expect(parseSignInLink(`  ${T} `, O)).toBe(`/auth/callback?token=${T}`);
    expect(parseSignInLink(`<${O}/auth/callback?token=${T}>`, O)).toBe(
      `/auth/callback?token=${T}`,
    );
  });

  it('finds the link in the whole copied DM (mobile "Copy Text")', () => {
    const dm =
      `Your Studies DB link (valid for 15 minutes, single use): <${O}/auth/callback?token=${T}>\n` +
      "Using the installed app? Copy this link and paste it on the app's sign-in screen.";
    expect(parseSignInLink(dm, O)).toBe(`/auth/callback?token=${T}`);
    // Without the <> (a client that copies the displayed text).
    expect(parseSignInLink(dm.replace(/[<>]/g, ''), O)).toBe(
      `/auth/callback?token=${T}`,
    );
    // A message whose only link is another site's stays refused.
    expect(
      parseSignInLink(
        `Sign in: https://evil.example/auth/callback?token=${T}`,
        O,
      ),
    ).toBeNull();
  });

  it('rejects anything else', () => {
    for (const bad of [
      '',
      '   ',
      `https://evil.example/auth/callback?token=${T}`,
      `${O}/auth/callbackx?token=${T}`,
      `${O}/auth/callback`,
      `${O}/auth/callback?token=${T}&next=%2Fsql`,
      `${O}/auth/callback?token=${T}&next=//evil.example`,
      `${O}/auth/callback?token=a.b`,
      `${O}/auth/callback?token=a%2Fb`,
      'a b',
      'x'.repeat(MAX_TOKEN_LEN + 1),
      'javascript:alert(1)',
    ]) {
      expect(parseSignInLink(bad, O), bad).toBeNull();
    }
    expect(parseSignInLink('x'.repeat(MAX_TOKEN_LEN), O)).not.toBeNull();
  });
});
