import { Notice } from '@/components/Notice';
import { SESSION_ENDED } from '@/lib/notices';

export default async function LoginInfo({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; expired?: string }>;
}) {
  const { error, expired } = await searchParams;
  return (
    <main className="mx-auto flex max-w-lg flex-col gap-4 p-8">
      <h1 className="m-0 text-2xl font-semibold">Studies DB · TP 4.0</h1>
      {error === 'expired' && (
        <p className="m-0 rounded border border-red-400 p-3 text-red-600 dark:text-red-400">
          This link has expired or was already used. Type /link again.
        </p>
      )}
      {/* Set by requireUser() and proxy.ts when a session stops working. */}
      <Notice text={expired === '1' ? SESSION_ENDED : null} param={null} />
      <p className="m-0">
        To sign in, type /link on your year's Discord server. The bot will send
        you a sign-in link.
      </p>
    </main>
  );
}
