export default async function LoginInfo({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="mb-4 text-2xl font-semibold">Studies DB · TP 4.0</h1>
      {error === 'expired' && (
        <p className="mb-4 rounded border border-red-400 p-3 text-red-600 dark:text-red-400">
          This link has expired or was already used. Type /link again.
        </p>
      )}
      <p>
        To sign in, type /link on your year's Discord server. The bot will send
        you a sign-in link.
      </p>
    </main>
  );
}
