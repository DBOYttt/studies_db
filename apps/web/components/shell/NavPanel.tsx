'use client';

import {
  BookOpenText,
  CalendarBlank,
  CaretDown,
  CaretRight,
  Database,
  Folder,
  FolderOpen,
  Funnel,
  HardDrives,
  House,
  type Icon,
  MagnifyingGlass,
  ShieldCheck,
  SignOut,
  Stack,
  Table,
  TerminalWindow,
  TreeStructure,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { type ReactNode, Suspense, useEffect, useState } from 'react';
import {
  activeNavKey,
  filterNavSubjects,
  filterNavViews,
  type NavSubject,
  type NavView,
  navAncestors,
  navKey,
} from '@/lib/nav-tree';

const TOOLBAR: { title: string; href: string; icon: Icon }[] = [
  { title: 'Strona główna', href: '/', icon: House },
  { title: 'Konsola SQL', href: '/sql', icon: TerminalWindow },
  { title: 'Szukaj', href: '/search', icon: MagnifyingGlass },
  { title: 'Projektant', href: '/schema', icon: TreeStructure },
];

const toolBtn =
  'grid h-[26px] w-[28px] place-items-center rounded text-accent-ink hover:bg-line';

/** Left navigation panel: logo, icon toolbar, name filter and the database tree. */
export function NavPanel({
  subjects,
  views,
  isAdmin = false,
}: {
  subjects: NavSubject[];
  views: NavView[];
  /** Shows the "Admin" toolbar entry (/admin). */
  isAdmin?: boolean;
}) {
  const [filter, setFilter] = useState('');
  const treeProps = { subjects, views, filter };
  return (
    <>
      <Link
        href="/"
        className="flex items-baseline gap-1.5 px-3.5 pt-3.5 pb-2.5 text-fg no-underline"
      >
        <Database
          weight="fill"
          size={20}
          className="self-center text-accent-ink"
          aria-hidden
        />
        <span className="text-[17px] font-bold tracking-[-0.02em]">
          Studies<span className="text-accent-ink">DB</span>
        </span>
        <span className="font-mono text-[11px] text-muted">TP 4.0</span>
      </Link>
      <div className="flex gap-0.5 px-2.5 pb-2.5">
        {TOOLBAR.map(({ title, href, icon: I }) => (
          <Link
            key={href}
            href={href}
            title={title}
            aria-label={title}
            className={toolBtn}
          >
            <I size={16} />
          </Link>
        ))}
        {isAdmin && (
          <>
            <span aria-hidden className="mx-1 my-[5px] w-px bg-line" />
            <AdminLink />
          </>
        )}
        <form action="/auth/logout" method="post" className="ml-auto">
          <button
            type="submit"
            title="Wyloguj"
            aria-label="Wyloguj"
            className={toolBtn}
          >
            <SignOut size={16} />
          </button>
        </form>
      </div>
      <div className="px-2.5 pb-2">
        <label className="flex h-7 items-center gap-1.5 rounded border border-line-strong bg-panel px-2 focus-within:outline-2 focus-within:outline-accent">
          <Funnel className="shrink-0 text-faint" aria-hidden />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtruj według nazwy"
            aria-label="Filtruj według nazwy"
            className="min-w-0 flex-1 border-0 bg-transparent outline-none placeholder:text-faint"
          />
        </label>
      </div>
      <nav
        aria-label="Drzewo bazy danych"
        className="min-h-0 flex-1 overflow-auto border-t border-line pt-1 pb-3"
      >
        <Suspense fallback={<NavTree {...treeProps} active={null} />}>
          <LocatedNavTree {...treeProps} />
        </Suspense>
      </nav>
    </>
  );
}

function AdminLink() {
  return (
    <Suspense fallback={<AdminLinkBody active={false} />}>
      <LocatedAdminLink />
    </Suspense>
  );
}

function LocatedAdminLink() {
  const pathname = usePathname();
  return (
    <AdminLinkBody
      active={pathname === '/admin' || pathname.startsWith('/admin/')}
    />
  );
}

/** Toolbar entry of the admin panel, set apart from the database tools. */
function AdminLinkBody({ active }: { active: boolean }) {
  return (
    <Link
      href="/admin"
      title="Admin"
      aria-label="Admin"
      aria-current={active ? 'page' : undefined}
      className={`${toolBtn} ${active ? 'bg-selected text-fg' : ''}`}
    >
      <ShieldCheck size={16} weight={active ? 'fill' : 'regular'} />
    </Link>
  );
}

type TreeProps = { subjects: NavSubject[]; views: NavView[]; filter: string };

function LocatedNavTree(props: TreeProps) {
  const pathname = usePathname();
  const search = useSearchParams();
  const active = activeNavKey(pathname, search, props.subjects, props.views);
  return <NavTree {...props} active={active} />;
}

function NavTree({
  subjects,
  views,
  filter,
  active,
}: TreeProps & { active: string | null }) {
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  // The active node opens too, so its children (a subject's classes, a
  // class's groups) are the next step of the drill-down.
  const ancestors = active ? [...navAncestors(active), active] : [];
  const ancestorsKey = ancestors.join('\n');

  // Navigating to a node re-opens it and its ancestors even if the user
  // closed them.
  useEffect(() => {
    if (!ancestorsKey) return;
    setOverrides((o) => {
      const next = { ...o };
      for (const k of ancestorsKey.split('\n')) delete next[k];
      return next;
    });
  }, [ancestorsKey]);

  const isOpen = (key: string) =>
    overrides[key] ??
    (key === navKey.subjects ||
      key === navKey.views ||
      ancestors.includes(key));
  const toggle = (key: string) =>
    setOverrides((o) => ({ ...o, [key]: !isOpen(key) }));

  const shownSubjects = filterNavSubjects(subjects, filter);
  const shownViews = filterNavViews(views, filter);

  return (
    <ul>
      <Row depth={0} icon={HardDrives} label="MariaDB" href="/" strong plain />
      <Row
        depth={1}
        icon={Database}
        iconClass="text-accent-ink"
        label="studies_db"
        href="/structure"
        strong
        active={active === navKey.db}
      />
      <Row
        depth={2}
        icon={CalendarBlank}
        iconClass="text-accent-ink"
        label="Plan zajęć"
        href="/plan"
        active={active === navKey.plan}
      />
      <Row
        depth={2}
        icon={isOpen(navKey.subjects) ? FolderOpen : Folder}
        iconClass="text-folder"
        label="Przedmioty"
        count={subjects.length}
        plain
        open={isOpen(navKey.subjects)}
        onToggle={() => toggle(navKey.subjects)}
      >
        {shownSubjects.map((s) => {
          const sk = navKey.subject(s.code);
          return (
            <Row
              key={s.code}
              depth={3}
              icon={BookOpenText}
              label={s.name}
              title={`${s.name} (${s.code})`}
              href={s.href}
              count={s.fileCount}
              active={active === sk}
              open={s.classes.length > 0 ? isOpen(sk) : undefined}
              onToggle={() => toggle(sk)}
            >
              {s.classes.map((c) => {
                const ck = navKey.cls(s.code, c.kind);
                return (
                  <Row
                    key={c.kind}
                    depth={4}
                    icon={Stack}
                    label={c.name}
                    href={c.href}
                    count={c.fileCount}
                    active={active === ck}
                    open={c.groups.length > 0 ? isOpen(ck) : undefined}
                    onToggle={() => toggle(ck)}
                  >
                    {c.groups.map((g) => (
                      <Row
                        key={g.number}
                        depth={5}
                        icon={UsersThree}
                        label={g.name}
                        href={g.href}
                        count={g.fileCount}
                        active={
                          active === navKey.group(s.code, c.kind, g.number)
                        }
                      />
                    ))}
                  </Row>
                );
              })}
            </Row>
          );
        })}
      </Row>
      <Row
        depth={2}
        icon={isOpen(navKey.views) ? FolderOpen : Folder}
        iconClass="text-folder"
        label="Widoki"
        count={views.length}
        plain
        open={isOpen(navKey.views)}
        onToggle={() => toggle(navKey.views)}
      >
        {shownViews.map((v) => (
          <Row
            key={v.name}
            depth={3}
            icon={Table}
            label={v.name}
            mono
            href={v.href}
            count={v.rowCount ?? undefined}
            active={active === navKey.view(v.name)}
          />
        ))}
      </Row>
    </ul>
  );
}

/**
 * One tree node (design: 24px row, indent 8 + 14 * depth). `open` undefined
 * means a leaf; nodes without `href` toggle on click (folders).
 */
function Row({
  depth,
  icon: I,
  iconClass = 'text-muted',
  label,
  title,
  href,
  count,
  active = false,
  strong = false,
  plain = false,
  mono = false,
  open,
  onToggle,
  children,
}: {
  depth: number;
  icon: Icon;
  iconClass?: string;
  label: string;
  title?: string;
  href?: string;
  count?: number;
  active?: boolean;
  strong?: boolean;
  /** Text in the foreground colour instead of the link colour. */
  plain?: boolean;
  mono?: boolean;
  open?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const hasKids = open !== undefined;
  const tone = active
    ? 'text-fg font-semibold'
    : `${plain ? 'text-fg' : 'text-accent-ink'} ${strong ? 'font-semibold' : ''}`;
  const body = (
    <>
      <I size={15} className={`shrink-0 ${iconClass}`} aria-hidden />
      <span
        className={`min-w-0 flex-1 truncate group-hover:underline ${mono ? 'font-mono' : ''}`}
      >
        {label}
      </span>
      {count !== undefined && (
        <span className="font-mono text-[11px] font-normal text-faint">
          {count}
        </span>
      )}
    </>
  );
  const bodyClass = `group flex min-w-0 flex-1 items-center gap-[5px] self-stretch pr-2.5 text-left ${tone}`;
  return (
    <li>
      <div
        className={`flex h-6 items-center gap-[5px] ${active ? 'bg-selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {hasKids ? (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-label={`${open ? 'Zwiń' : 'Rozwiń'}: ${label}`}
            className="grid h-full w-3.5 shrink-0 place-items-center text-faint"
          >
            {open ? <CaretDown size={11} /> : <CaretRight size={11} />}
          </button>
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {href ? (
          <Link
            href={href}
            title={title}
            aria-current={active ? 'page' : undefined}
            className={bodyClass}
          >
            {body}
          </Link>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className={bodyClass}
          >
            {body}
          </button>
        )}
      </div>
      {hasKids && open && children ? <ul>{children}</ul> : null}
    </li>
  );
}
