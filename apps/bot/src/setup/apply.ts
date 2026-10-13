// Executes a /setup plan against the guild, one action at a time. A failing
// action is recorded and later actions for the same subject are skipped; the
// rest of the plan still runs.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CLASS_NAMES,
  type Db,
  ensureClass,
  materials,
  subjects,
  topics,
} from '@studies/db';
import { eq } from 'drizzle-orm';
import { syncForumTags } from '../sync.js';
import type { ForumTag } from '../types.js';
import { INFO_TITLE } from './info.js';
import type { Action, GuildSnapshot, PostFile } from './types.js';

export type UploadFile = { path: string; name: string };
export type SentMessage = { messageId: string; attachmentIds: string[] };

/** The guild operations /setup needs (discord.js implementation in discord.ts). */
export interface SetupGuild {
  createRole(name: string): Promise<string>;
  addRoleToMember(userId: string, roleId: string): Promise<void>;
  createCategory(name: string): Promise<string>;
  createForum(o: {
    name: string;
    parentId: string;
    tags: string[];
    topic: string;
  }): Promise<{ id: string; tags: ForumTag[] }>;
  /** Appends tags; returns the forum's full tag list afterwards. */
  addForumTags(channelId: string, names: string[]): Promise<ForumTag[]>;
  setForumTopic(channelId: string, topic: string): Promise<void>;
  /** New forum post; attachment ids come back in upload order. */
  createThread(
    forumId: string,
    o: { name: string; tagIds: string[]; content: string; files: UploadFile[] },
  ): Promise<SentMessage & { threadId: string }>;
  sendMessage(
    threadId: string,
    o: { content: string; files: UploadFile[] },
  ): Promise<SentMessage>;
  editMessage(
    threadId: string,
    messageId: string,
    content: string,
  ): Promise<void>;
  pinThread(threadId: string): Promise<void>;
}

export type SetupReport = {
  created: string[];
  updated: string[];
  warnings: string[];
  failures: string[];
};

const errText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/** Points the materials at the message/attachments they were re-uploaded as. */
async function relinkFiles(db: Db, files: PostFile[], sent: SentMessage) {
  for (const [i, f] of files.entries()) {
    await db
      .update(materials)
      .set({
        discordMessageId: sent.messageId,
        discordAttachmentId: sent.attachmentIds[i],
      })
      .where(eq(materials.id, f.materialId));
  }
}

export async function applySetup(
  db: Db,
  guild: SetupGuild,
  actions: Action[],
  snapshot: GuildSnapshot,
  storageDir = '',
): Promise<SetupReport> {
  const uploads = async (files: PostFile[]): Promise<UploadFile[]> => {
    const out: UploadFile[] = [];
    for (const f of files) {
      const path = join(storageDir, f.storagePath);
      try {
        await access(path);
      } catch {
        throw new Error(`brak pliku ${f.name} w magazynie`);
      }
      out.push({ path, name: f.name });
    }
    return out;
  };
  const report: SetupReport = {
    created: [],
    updated: [],
    warnings: [],
    failures: [],
  };
  const roles = new Map(snapshot.roles.map((r) => [r.name, r.id]));
  const categories = new Map(snapshot.categories.map((c) => [c.name, c.id]));
  const failedSubjects = new Set<number>();

  for (const a of actions) {
    if ('subjectId' in a && failedSubjects.has(a.subjectId)) continue;
    const label = 'code' in a && a.code ? a.code : '';
    try {
      switch (a.type) {
        case 'createRole':
          roles.set(a.name, await guild.createRole(a.name));
          report.created.push(`rola ${a.name}`);
          break;
        case 'assignRole': {
          const roleId = roles.get(a.roleName);
          if (!roleId) throw new Error(`brak roli ${a.roleName}`);
          await guild.addRoleToMember(a.userId, roleId);
          report.updated.push(`nadano Ci rolę ${a.roleName}`);
          break;
        }
        case 'createCategory':
          categories.set(a.name, await guild.createCategory(a.name));
          report.created.push(`kategoria ${a.name}`);
          break;
        case 'createForum': {
          const parentId = categories.get(a.categoryName);
          if (!parentId) throw new Error(`brak kategorii ${a.categoryName}`);
          const forum = await guild.createForum({
            name: a.name,
            parentId,
            tags: a.tags,
            topic: a.topic,
          });
          // Link right away so a later crash never leaves an unknown forum.
          try {
            await db
              .update(subjects)
              .set({ discordChannelId: forum.id })
              .where(eq(subjects.id, a.subjectId));
          } catch (err) {
            throw new Error(
              `utworzono forum #${a.name}, ale nie udało się go połączyć (${errText(err)})`,
            );
          }
          await syncForumTags(db, a.subjectId, forum.tags);
          report.created.push(`${a.code}: forum #${a.name}`);
          break;
        }
        case 'addTags': {
          const all = await guild.addForumTags(a.channelId, a.tags);
          await syncForumTags(db, a.subjectId, all);
          report.updated.push(`${a.code}: tagi ${a.tags.join(', ')}`);
          break;
        }
        case 'setGuidelines':
          await guild.setForumTopic(a.channelId, a.topic);
          report.updated.push(`${a.code}: wytyczne forum`);
          break;
        case 'importForum': {
          const [{ id }] = await db
            .insert(subjects)
            .values({
              code: a.code,
              name: a.name,
              semester: a.semester,
              ects: 0,
              discordChannelId: a.channelId,
            })
            .$returningId();
          for (const kind of a.classKinds) await ensureClass(db, id, kind);
          await syncForumTags(db, id, a.tags);
          report.created.push(
            `${a.code}: przedmiot „${a.name}” z forum #${a.forumName} (ECTS 0 — popraw przez /subject edit)`,
          );
          break;
        }
        case 'addClasses':
          for (const kind of a.kinds) await ensureClass(db, a.subjectId, kind);
          report.updated.push(
            `${a.code}: zajęcia ${a.kinds.map((k) => CLASS_NAMES[k]).join(', ')}`,
          );
          break;
        case 'postTopic': {
          // Check every file before posting anything for this topic.
          const prepared = [];
          for (const m of a.messages) {
            prepared.push({ ...m, uploads: await uploads(m.files) });
          }
          const [first, ...rest] = prepared;
          const thread = await guild.createThread(a.channelId, {
            name: a.title,
            tagIds: a.tagIds,
            content: first.content,
            files: first.uploads,
          });
          // Link right away so a re-run never posts the topic twice.
          await db
            .update(topics)
            .set({ discordThreadId: thread.threadId })
            .where(eq(topics.id, a.topicId));
          await relinkFiles(db, first.files, thread);
          for (const m of rest) {
            const sent = await guild.sendMessage(thread.threadId, {
              content: m.content,
              files: m.uploads,
            });
            await relinkFiles(db, m.files, sent);
          }
          const n = prepared.reduce((k, m) => k + m.files.length, 0);
          report.created.push(`${a.code}: post „${a.title}” (${n} plików)`);
          break;
        }
        case 'upsertInfoPost': {
          const e = a.existing;
          if (!e) {
            const t = await guild.createThread(a.channelId, {
              name: INFO_TITLE,
              tagIds: [],
              content: a.content,
              files: [],
            });
            await guild.pinThread(t.threadId);
            report.created.push(`${a.code}: post informacyjny`);
            break;
          }
          if (!e.same)
            await guild.editMessage(e.threadId, e.messageId, a.content);
          if (!e.pinned) await guild.pinThread(e.threadId);
          report.updated.push(`${a.code}: post informacyjny`);
          break;
        }
        case 'warn':
          report.warnings.push(a.code ? `${a.code}: ${a.message}` : a.message);
          break;
      }
    } catch (err) {
      // A failed post only affects that topic; other failures stop the subject.
      if ('subjectId' in a && a.type !== 'postTopic') {
        failedSubjects.add(a.subjectId);
      }
      const what = label || a.type;
      report.failures.push(`${what}: ${errText(err)}`);
    }
  }
  return report;
}
