import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SemesterEmpty } from '@/components/SemesterEmpty';
import { FileList } from '@/components/simple/FileList';
import { SimpleAdminEntry } from '@/components/simple/SimpleAdminEntry';
import { SimplePreview } from '@/components/simple/SimplePreview';
import { SimpleShell } from '@/components/simple/SimpleShell';
import { SubjectCards } from '@/components/simple/SubjectCards';
import { TodayCard } from '@/components/simple/TodayCard';
import { UpcomingEvents } from '@/components/simple/UpcomingEvents';
import { cachedSubjectCards } from '@/lib/count-cache';
import { getDb, getViewsPool } from '@/lib/db';
import { loadMyGroups } from '@/lib/my-groups-load';
import { semesterPageMetadata } from '@/lib/page-meta';
import { nowWall, type PlanSession } from '@/lib/plan';
import { currentSemester } from '@/lib/semester';
import { requireUser } from '@/lib/session';
import { isoFiles, loadSimplePreview, navSubjects } from '@/lib/simple-page';
import { listSimpleFiles } from '@/lib/simple-queries';
import { type TodayClasses, todayForUser } from '@/lib/today';
import { upcomingForUser } from '@/lib/upcoming-events';

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  return semesterPageMetadata('Start', await searchParams);
}

export const dynamic = 'force-dynamic';

type SP = Record<string, string | string[] | undefined>;

export default async function SimpleStart({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = getDb();
  const semester = await currentSemester(sp);
  const cardsP = cachedSubjectCards(semester);
  // Started now, awaited in its own Suspense boundary so the rest of the
  // page does not wait for it. Events are optional on the start page: a
  // failure leaves the card empty.
  // My groups is read once for both cards.
  const pool = getViewsPool();
  const mine = loadMyGroups(db, pool, user.id);
  const upcoming = upcomingForUser(
    db,
    pool,
    user.id,
    nowWall(),
    5,
    mine,
    semester,
  ).catch(() => []);
  // Today's classes stream the same way; a failure says so in the card.
  const today = todayForUser(db, pool, user.id, new Date(), {
    mine,
    semester,
  }).catch(() => 'error' as const);
  const [cards, recent, preview] = await Promise.all([
    cardsP,
    listSimpleFiles(db, { limit: 5, withTotal: false, semester }),
    loadSimplePreview(db, sp, cachedSubjectCards()),
  ]);
  return (
    <SimpleShell
      subjects={navSubjects(cards)}
      active={{ screen: 'home' }}
      crumbs={[{ label: 'Start', href: '/s' }]}
      user={user}
      adminEntry={user.isAdmin ? <SimpleAdminEntry /> : null}
      aside={
        preview && (
          <SimplePreview
            file={preview.file}
            closeHref="/s"
            meta={{ subjectName: preview.subjectName }}
          />
        )
      }
    >
      <h1 className="sr-only">Start</h1>
      {/* What's next first: today's classes and upcoming events above the
          subject grid. */}
      <Suspense fallback={<TodayCard today={null} />}>
        <TodaySlot today={today} />
      </Suspense>
      <Suspense fallback={<UpcomingEvents events={null} />}>
        <UpcomingSlot events={upcoming} />
      </Suspense>
      <div>
        <h2 className="mt-3 mb-0 text-base font-semibold">Subjects</h2>
        {cards.length > 0 && (
          <p className="mt-1 mb-0 text-pretty text-muted">
            Pick a subject to see its class materials.
          </p>
        )}
      </div>
      {cards.length > 0 ? (
        <SubjectCards cards={cards} />
      ) : (
        <div className="rounded-lg border border-line-strong bg-panel px-4 py-6 text-center text-muted">
          {semester === null ? (
            'No subjects yet.'
          ) : (
            <SemesterEmpty semester={semester} path="/s" />
          )}
        </div>
      )}
      <h2 className="mt-3 mb-0 text-base font-semibold">Recently added</h2>
      <FileList
        files={isoFiles(recent.rows)}
        withSubject
        selectedId={preview?.file.id ?? null}
        baseHref="/s"
        emptyText={
          semester === null
            ? 'No files have been added yet.'
            : `No files in semester ${semester} yet.`
        }
      />
    </SimpleShell>
  );
}

async function TodaySlot({
  today,
}: {
  today: Promise<TodayClasses | 'error'>;
}) {
  return <TodayCard today={await today} />;
}

async function UpcomingSlot({ events }: { events: Promise<PlanSession[]> }) {
  return <UpcomingEvents events={await events} />;
}
