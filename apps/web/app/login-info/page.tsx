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
          Link wygasł lub został już użyty. Wpisz /link ponownie.
        </p>
      )}
      <p>
        Aby wejść, wpisz /link na serwerze Discord rocznika — bot wyśle Ci link
        logowania.
      </p>
    </main>
  );
}
