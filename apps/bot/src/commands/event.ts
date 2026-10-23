/** `/event add`: the slash-command twin of the "Add event" modal. */
import {
  addEvent,
  addSeries,
  classes,
  classGroups,
  events,
  subjects,
  upsertUser,
} from '@studies/db';
import type { EventKind } from '@studies/db/constants';
import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { and, asc, eq } from 'drizzle-orm';
import type { DiscordUser } from '../types.js';
import { cardView } from '../ui/events.js';
import { replyOptions } from './reply.js';
import type { RouterDeps } from './router.js';

export const UNTIL_MISSING = 'Choose how long to repeat (the until option).';
export const REPEAT_MISSING =
  'The until option only works with the repeat option.';

export async function runEventAdd(
  deps: RouterDeps,
  i: ChatInputCommandInteraction,
  callerId: number | undefined,
  user: DiscordUser,
): Promise<void> {
  const { db } = deps.ingest;
  if (i.options.getSubcommand() !== 'add') return;
  // Acknowledge first: the lookups below can take a while.
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const say = (text: string) => i.editReply(replyOptions(text));
  const userId = callerId ?? (await upsertUser(db, user));

  let subjectId: number | null = null;
  const code = i.options.getString('subject')?.trim().toUpperCase();
  if (code) {
    const [s] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.code, code));
    if (!s) return void (await say(`Subject ${code} not found.`));
    subjectId = s.id;
  }
  let classId: number | null = null;
  let groupId: number | null = null;
  const classKind = i.options.getString('class');
  const groupNo = i.options.getInteger('group');
  if (classKind) {
    if (subjectId === null) {
      return void (await say(
        'A class can only be chosen together with a subject.',
      ));
    }
    const [c] = await db
      .select({ id: classes.id })
      .from(classes)
      .where(
        and(
          eq(classes.subjectId, subjectId),
          eq(classes.kind, classKind as never),
        ),
      );
    if (!c) return void (await say('This subject has no such class.'));
    classId = c.id;
    if (groupNo !== null) {
      const [g] = await db
        .select({ id: classGroups.id })
        .from(classGroups)
        .where(
          and(eq(classGroups.classId, c.id), eq(classGroups.number, groupNo)),
        );
      if (!g) return void (await say(`Group ${groupNo} not found.`));
      groupId = g.id;
    }
  } else if (groupNo !== null) {
    return void (await say(
      'A group can only be chosen together with a class.',
    ));
  }

  const input = {
    kind: i.options.getString('kind', true) as EventKind,
    title: i.options.getString('title', true),
    subjectId,
    classId,
    groupId,
    when: i.options.getString('when', true),
    place: i.options.getString('place'),
    note: i.options.getString('note'),
  };
  const repeat = i.options.getString('repeat');
  const until = i.options.getString('until')?.trim();
  if (until && !repeat) return void (await say(REPEAT_MISSING));
  if (repeat && !until) return void (await say(UNTIL_MISSING));
  const r =
    repeat && until
      ? await addSeries(
          db,
          userId,
          { ...input, rule: repeat as 'weekly' | 'biweekly', until },
          'discord',
        )
      : await addEvent(db, userId, input, 'discord');
  if (!r.ok || r.id === undefined) {
    await i.editReply(replyOptions(r.message));
    return;
  }
  let eventId = r.id;
  if (repeat) {
    // The card shows the first occurrence of the new series.
    const [first] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.seriesId, r.id))
      .orderBy(asc(events.startsAt), asc(events.id))
      .limit(1);
    if (!first) return void (await say(r.message));
    eventId = first.id;
  }
  const v = await cardView(deps, eventId, deps.pool);
  await i.editReply({
    components: v.components,
    flags: v.flags,
    allowedMentions: { parse: [] as never[] },
  });
}
