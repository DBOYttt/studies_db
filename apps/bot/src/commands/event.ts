/** `/event add`: the slash-command twin of the "Dodaj wydarzenie" modal. */
import {
  addEvent,
  classes,
  classGroups,
  subjects,
  upsertUser,
} from '@studies/db';
import type { EventKind } from '@studies/db/constants';
import { type ChatInputCommandInteraction, MessageFlags } from 'discord.js';
import { and, eq } from 'drizzle-orm';
import type { DiscordUser } from '../types.js';
import { cardView } from '../ui/events.js';
import { replyOptions } from './reply.js';
import type { RouterDeps } from './router.js';

export const REPEAT_SOON = 'Powtarzanie będzie dostępne wkrótce';

export async function runEventAdd(
  deps: RouterDeps,
  i: ChatInputCommandInteraction,
  callerId: number | undefined,
  user: DiscordUser,
): Promise<void> {
  const { db } = deps.ingest;
  const say = (text: string) => i.reply(replyOptions(text, true));
  if (i.options.getSubcommand() !== 'add') return;
  if (i.options.getString('repeat') || i.options.getString('until')) {
    await say(REPEAT_SOON);
    return;
  }
  const userId = callerId ?? (await upsertUser(db, user));

  let subjectId: number | null = null;
  const code = i.options.getString('subject')?.trim().toUpperCase();
  if (code) {
    const [s] = await db
      .select({ id: subjects.id })
      .from(subjects)
      .where(eq(subjects.code, code));
    if (!s) return void (await say(`Nie znaleziono przedmiotu ${code}.`));
    subjectId = s.id;
  }
  let classId: number | null = null;
  let groupId: number | null = null;
  const classKind = i.options.getString('class');
  const groupNo = i.options.getInteger('group');
  if (classKind) {
    if (subjectId === null) {
      return void (await say('Zajęcia można wybrać tylko z przedmiotem.'));
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
    if (!c) return void (await say('Ten przedmiot nie ma takich zajęć.'));
    classId = c.id;
    if (groupNo !== null) {
      const [g] = await db
        .select({ id: classGroups.id })
        .from(classGroups)
        .where(
          and(eq(classGroups.classId, c.id), eq(classGroups.number, groupNo)),
        );
      if (!g) return void (await say(`Nie znaleziono grupy ${groupNo}.`));
      groupId = g.id;
    }
  } else if (groupNo !== null) {
    return void (await say('Grupę można wybrać tylko razem z zajęciami.'));
  }

  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const r = await addEvent(
    db,
    userId,
    {
      kind: i.options.getString('kind', true) as EventKind,
      title: i.options.getString('title', true),
      subjectId,
      classId,
      groupId,
      when: i.options.getString('when', true),
      place: i.options.getString('place'),
      note: i.options.getString('note'),
    },
    'discord',
  );
  if (!r.ok || r.id === undefined) {
    await i.editReply(replyOptions(r.message));
    return;
  }
  const v = await cardView(deps, r.id);
  await i.editReply({
    components: v.components,
    flags: v.flags,
    allowedMentions: { parse: [] as never[] },
  });
}
