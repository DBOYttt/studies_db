import { CheckCircle, WarningCircle } from '@phosphor-icons/react/dist/ssr';
import { searchAll } from '@studies/db';
import Link from 'next/link';
import { Highlight } from '@/components/Highlight';
import { dbTabs } from '@/components/shell/db-tabs';
import { ScreenHeader } from '@/components/shell/ScreenHeader';
import { getDb } from '@/lib/db';
import { explorerHref } from '@/lib/explorer';
import { plural } from '@/lib/format';
import { listAllTags, listSubjectOptions } from '@/lib/queries';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const SEARCH_LIMIT = 100;

const posInt = (v: string | undefined) =>
  /^[1-9]\d{0,9}$/.test(v ?? '') ? Number(v) : undefined;

const field =
  'rounded border border-line-strong bg-page font-[inherit] text-fg';
const th = 'border-b border-line-strong px-2.5 py-[7px] font-semibold';
const td = 'border-b border-line px-2.5 py-1 align-top';

/** Database full-text search (design lines 262-308), GET form. */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; subject?: string; tag?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const q = (typeof sp.q === 'string' ? sp.q : '').slice(0, 200).trim();
  const subjectId = posInt(sp.subject);
  const tagId = posInt(sp.tag);
  const db = getDb();
  const [subjects, tags, hits] = await Promise.all([
    listSubjectOptions(db),
    listAllTags(db),
    q
      ? searchAll(db, { q, subjectId, tagId, limit: SEARCH_LIMIT })
      : Promise.resolve([]),
  ]);
  // searchAll caps at SEARCH_LIMIT (its maximum): a full page means "maybe more".
  const capped = hits.length >= SEARCH_LIMIT;

  return (
    <>
      <ScreenHeader tabs={dbTabs('search')} />
      <div className="flex flex-col gap-3">
        <h1 className="sr-only">Szukaj</h1>
        <form method="get" action="/search">
          <fieldset className="m-0 rounded-md border border-line-strong bg-panel p-0">
            <legend className="ml-2.5 px-1.5 font-semibold">
              Szukaj w materiałach i tematach
            </legend>
            <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2.5 px-3.5 pt-2 pb-3.5 max-sm:grid-cols-1 max-sm:gap-y-1.5">
              <label htmlFor="search-q" className="text-muted">
                Słowa do wyszukania:
              </label>
              <input
                id="search-q"
                name="q"
                defaultValue={q}
                placeholder="Szukaj w materiałach i tematach…"
                className={`${field} w-full max-w-[480px] px-2 py-1.5`}
              />
              <label htmlFor="search-subject" className="text-muted">
                Przedmiot:
              </label>
              <select
                id="search-subject"
                name="subject"
                defaultValue={subjectId ?? ''}
                className={`${field} w-full max-w-[300px] px-1.5 py-[5px]`}
              >
                <option value="">Wszystkie przedmioty</option>
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <label htmlFor="search-tag" className="text-muted">
                Tag:
              </label>
              <select
                id="search-tag"
                name="tag"
                defaultValue={tagId ?? ''}
                className={`${field} w-full max-w-[300px] px-1.5 py-[5px]`}
              >
                <option value="">Wszystkie tagi</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.subjectCode})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end rounded-b-md border-t border-line bg-bar px-3 py-2.5">
              <button
                type="submit"
                className="rounded bg-accent-fill px-[18px] py-1.5 font-semibold text-on-accent hover:bg-accent-fill-hover"
              >
                Wykonaj
              </button>
            </div>
          </fieldset>
        </form>

        {q && hits.length > 0 && (
          <>
            <div
              role="status"
              className="flex items-center gap-2 rounded-md border border-ok-line bg-ok-bg px-3 py-2 text-ok-fg"
            >
              <CheckCircle size={16} weight="fill" aria-hidden />
              <span>
                Wyniki wyszukiwania „<b>{q}</b>”:{' '}
                {capped
                  ? `${SEARCH_LIMIT}+ trafień (pokazano pierwsze ${SEARCH_LIMIT})`
                  : plural(hits.length, 'match', 'matches')}
              </span>
            </div>
            <div className="shrink-0 overflow-auto rounded-md border border-line-strong">
              <table className="w-full min-w-[640px] border-collapse">
                <thead>
                  <tr className="bg-surface text-left">
                    <th className={th}>Wynik</th>
                    <th className={th}>Przedmiot</th>
                    <th className={th}>Fragment</th>
                  </tr>
                </thead>
                <tbody>
                  {hits.map((h, i) => (
                    <tr
                      key={`${h.topicId}-${h.materialId ?? 't'}`}
                      className={`hover:bg-list-hover ${i % 2 ? 'bg-zebra' : ''}`}
                    >
                      <td className={td}>
                        <Link
                          href={explorerHref(h.subjectCode, {
                            topic: h.topicId,
                            file: h.materialId,
                          })}
                          className="font-semibold text-accent-ink hover:text-accent-ink-hover hover:underline"
                        >
                          {h.filename ?? h.topicTitle}
                        </Link>
                        <div className="text-xs text-muted">
                          {h.filename ? `temat: ${h.topicTitle}` : 'temat'}
                        </div>
                      </td>
                      <td className={`${td} text-muted`}>
                        {h.subjectName} ({h.subjectCode})
                      </td>
                      <td className={td}>
                        <Highlight text={h.snippet} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        {q && hits.length === 0 && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-warn-fg"
          >
            <WarningCircle size={16} weight="fill" aria-hidden />
            <span>Brak wyników dla „{q}”.</span>
          </div>
        )}
      </div>
    </>
  );
}
