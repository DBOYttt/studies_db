import { CaretDown, CaretRight } from '@phosphor-icons/react/dist/ssr';
import Link from 'next/link';
import {
  type ExplorerFilters,
  type ExplorerParams,
  explorerHref,
} from '@/lib/explorer';
import { pluralPl } from '@/lib/format';
import type { TreeClass, TreeTopic } from '@/lib/queries';
import { type TreeOption, TreeSelect } from './TreeSelect';

const row =
  'flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm hover:bg-surface';
const active = 'bg-accent/10 font-medium text-accent-ink hover:bg-accent/10';

function Count({ n }: { n: number }) {
  return (
    <span
      className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted"
      title={`${n} ${pluralPl(n, 'plik', 'pliki', 'plików')}`}
    >
      {n}
    </span>
  );
}

export function ExplorerTree({
  code,
  tree,
  sel,
  filters,
}: {
  code: string;
  tree: TreeClass[];
  sel: ExplorerParams;
  filters: ExplorerFilters;
}) {
  const href = (p: Partial<ExplorerParams>) => explorerHref(code, p, filters);
  const options: TreeOption[] = [
    { href: href({}), label: 'Cały przedmiot', depth: 0 },
  ];
  for (const c of tree) {
    options.push({
      href: href({ classKind: c.kind }),
      label: `${c.name} (${c.fileCount})`,
      depth: 1,
    });
    for (const g of c.groups) {
      options.push({
        href: href({ classKind: c.kind, group: g.number }),
        label: `${g.name} (${g.fileCount})`,
        depth: 2,
      });
      for (const t of g.topics) {
        options.push({
          href: href({ classKind: c.kind, group: g.number, topic: t.id }),
          label: t.title,
          depth: 3,
        });
      }
    }
    for (const t of c.topics) {
      options.push({
        href: href({ classKind: c.kind, topic: t.id }),
        label: t.title,
        depth: 2,
      });
    }
  }
  const current = href({
    classKind: sel.classKind,
    group: sel.group,
    topic: sel.topic,
  });

  const topicLink = (
    t: TreeTopic,
    classKind: TreeClass['kind'],
    group: number | null,
  ) => {
    const on = sel.topic === t.id;
    return (
      <li key={t.id}>
        <Link
          href={href({ classKind, group, topic: t.id })}
          aria-current={on ? 'page' : undefined}
          className={`${row} ${on ? active : ''}`}
        >
          <span className="min-w-0 break-words">{t.title}</span>
          <Count n={t.fileCount} />
        </Link>
      </li>
    );
  };

  const allOn = !sel.classKind && sel.topic == null;
  const total = tree.reduce((n, c) => n + c.fileCount, 0);
  return (
    <>
      <div className="md:hidden">
        <TreeSelect options={options} value={current} />
      </div>
      <nav
        aria-label="Drzewo przedmiotu"
        className="hidden self-start rounded-xl border border-line bg-panel p-2 md:block"
      >
        <ul className="space-y-0.5">
          <li>
            <Link
              href={href({})}
              aria-current={allOn ? 'page' : undefined}
              className={`${row} ${allOn ? active : ''}`}
            >
              Cały przedmiot
              <Count n={total} />
            </Link>
          </li>
          {tree.map((c) => {
            const open = sel.classKind === c.kind;
            const classOn = open && sel.group == null && sel.topic == null;
            return (
              <li key={c.kind}>
                <Link
                  href={href({ classKind: c.kind })}
                  aria-current={classOn ? 'page' : undefined}
                  className={`${row} ${classOn ? active : ''}`}
                >
                  {open ? (
                    <CaretDown size={12} aria-hidden="true" />
                  ) : (
                    <CaretRight size={12} aria-hidden="true" />
                  )}
                  <span className="min-w-0 break-words">{c.name}</span>
                  <Count n={c.fileCount} />
                </Link>
                {c.lecturers.length > 0 && (
                  <ul className="mb-1 ml-7 space-y-0.5 text-xs text-muted">
                    {c.lecturers.map((l) => (
                      <li key={`${l.groupName}-${l.name}`}>
                        {l.groupName ? `${l.groupName}: ` : ''}
                        {[l.title, l.name].filter(Boolean).join(' ')}
                      </li>
                    ))}
                  </ul>
                )}
                {open && (
                  <ul className="ml-3 space-y-0.5 border-l border-line pl-2">
                    {c.groups.map((g) => {
                      const gOpen = sel.group === g.number;
                      const gOn = gOpen && sel.topic == null;
                      return (
                        <li key={g.id}>
                          <Link
                            href={href({ classKind: c.kind, group: g.number })}
                            aria-current={gOn ? 'page' : undefined}
                            className={`${row} ${gOn ? active : ''}`}
                          >
                            {gOpen ? (
                              <CaretDown size={12} aria-hidden="true" />
                            ) : (
                              <CaretRight size={12} aria-hidden="true" />
                            )}
                            {g.name}
                            <Count n={g.fileCount} />
                          </Link>
                          {gOpen && (
                            <ul className="ml-3 space-y-0.5 border-l border-line pl-2">
                              {g.topics.map((t) =>
                                topicLink(t, c.kind, g.number),
                              )}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                    {c.topics.map((t) => topicLink(t, c.kind, null))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
