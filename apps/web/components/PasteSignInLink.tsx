'use client';

import { useState } from 'react';
import { fieldAria, fieldErrorId } from '@/lib/field-errors';
import { parseSignInLink, SIGN_IN_LINK_ERROR } from '@/lib/install-app';
import { runsStandalone, useMounted } from './InstallAppButton';

const FORM_ID = 'paste-sign-in';

/**
 * Sign-in inside the installed app. On iOS the home-screen app keeps its own
 * cookies, so the bot's link (opened in Safari) cannot sign it in; pasting
 * the link here opens the same confirmation page inside the app.
 */
export function PasteSignInLink() {
  const mounted = useMounted();
  const [error, setError] = useState<{ field: string } | null>(null);
  if (!mounted || !runsStandalone()) return null;

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem('link');
    const path = parseSignInLink(
      input instanceof HTMLInputElement ? input.value : '',
      window.location.origin,
    );
    if (!path) {
      setError({ field: 'link' });
      if (input instanceof HTMLInputElement) input.focus();
      return;
    }
    window.location.assign(path);
  }

  return (
    <form
      id={FORM_ID}
      method="post"
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-2 rounded-lg border border-line p-4"
    >
      <label htmlFor={`${FORM_ID}-link`} className="text-sm font-medium">
        Paste your sign-in link
      </label>
      <p id={`${FORM_ID}-hint`} className="m-0 text-sm text-muted">
        In the installed app, sign in by pasting the link the bot sent you.
      </p>
      <div className="flex gap-2 max-sm:flex-col">
        <input
          id={`${FORM_ID}-link`}
          name="link"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={() => setError(null)}
          className="min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-sm max-sm:min-h-11"
          {...fieldAria(error, FORM_ID, 'link', `${FORM_ID}-hint`)}
        />
        <button
          type="submit"
          className="rounded-md bg-accent-fill px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-fill-hover max-sm:min-h-11"
        >
          Sign in
        </button>
      </div>
      {error && (
        <p
          id={fieldErrorId(FORM_ID, 'link')}
          className="m-0 text-sm text-err-fg"
        >
          {SIGN_IN_LINK_ERROR}
        </p>
      )}
    </form>
  );
}
