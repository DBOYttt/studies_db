// Executes a /setup plan against the guild, one action at a time. A failing
// action is recorded and later actions for the same subject are skipped; the
// rest of the plan still runs.
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CLASS_NAMES,
  type Db,
  ensureClass,
  getSetting,
  materials,
  setSetting,
  subjects,
  topics,
  users,
} from '@studies/db';
import { eq } from 'drizzle-orm';
import { ADMIN_ROLE_SETTING, PANEL_SETTINGS } from '../config.js';
import { syncForumTags } from '../sync.js';
import type { ForumTag } from '../types.js';
import { adminPanel } from '../ui/views/admin.js';
import type { View } from '../ui/views/parts.js';
import { studentPanel } from '../ui/views/student.js';
import { INFO_TITLE } from './info.js';
import { PANEL_CHANNEL_NAMES } from './plan.js';
import type { Action, GuildSnapshot, PanelWhich, PostFile } from './types.js';

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
  /**
   * New text channel. private false: everyone reads, nobody but the bot
   * writes. private true: only the bot and the admin role see it.
   */
  createTextChannel(o: {
    name: string;
    parentId: string | null;
    private: boolean;
    adminRoleId: string | null;
  }): Promise<string>;
  /**
   * Lets the admin role view #admin-panel without posting (as on creation)
   * and removes overwrites of roles that no longer exist.
   */
  syncAdminPanelPerms(channelId: string, roleId: string): Promise<void>;
  /** Posts and pins the panel; pinned false when pinning was refused. */
  postPanel(
    channelId: string,
    view: View,
  ): Promise<{ id: string; pinned: boolean }>;
  /**
   * Edits the panel in place and pins it if it isn't pinned. False when the
   * message (or its channel) is gone; other errors throw.
   */
  editPanel(
    channelId: string,
    messageId: string,
    view: View,
  ): Promise<false | { pinned: boolean }>;
}

const PANEL_VIEWS: Record<PanelWhich, () => View> = {
  panel: studentPanel,
  admin: adminPanel,
};

export type SetupReport = {
  created: string[];
  updated: string[];
  warnings: string[];
  failures: string[];
  /** Role id the run gave the caller (assignRole succeeded), if any. */
  assignedRoleId?: string;
};

/**
 * Pins the admin role id. When it replaces a different stored id, every
 * users.is_admin is cleared first: those flags mirrored the old role, and
 * holders of the new one get theirs back on their next bot command.
 */
async function storeAdminRole(db: Db, roleId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const previous = await getSetting(tx, ADMIN_ROLE_SETTING);
    if (previous !== null && previous !== roleId) {
      await tx
        .update(users)
        .set({ isAdmin: false })
        .where(eq(users.isAdmin, true));
    }
    await setSetting(tx, ADMIN_ROLE_SETTING, roleId);
  });
}

const errText = (err: unknown) =>
  err instanceof Error ? err.message : String(err);

/**
 * Points the materials at the message/attachments they were re-uploaded as.
 * Writes nothing and returns false if the attachment count does not match.
 */
async function relinkFiles(
  db: Db,
  files: PostFile[],
  sent: SentMessage,
): Promise<boolean> {
  if (sent.attachmentIds.length !== files.length) return false;
  for (const [i, f] of files.entries()) {
    await db
      .update(materials)
      .set({
        discordMessageId: sent.messageId,
        discordAttachmentId: sent.attachmentIds[i],
      })
      .where(eq(materials.id, f.materialId));
  }
  return true;
}

const unlinkedFiles = (code: string, title: string, n: number) =>
  `${code}: „${title}”: Discord nie potwierdził ${n} plików — zostały wysłane, ale nie są połączone w bazie`;

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
  let createdRoleId: string | null = null;
  const categories = new Map(snapshot.categories.map((c) => [c.name, c.id]));
  const failedSubjects = new Set<number>();
  /** Panel channels created or adopted in this run. */
  const panelChannels: Partial<Record<PanelWhich, string>> = {};

  for (const a of actions) {
    if ('subjectId' in a && failedSubjects.has(a.subjectId)) continue;
    const label =
      'code' in a && a.code
        ? a.code
        : 'which' in a
          ? `#${PANEL_CHANNEL_NAMES[a.which]}`
          : a.type === 'syncAdminPanelPerms'
            ? `#${PANEL_CHANNEL_NAMES.admin}`
            : '';
    try {
      switch (a.type) {
        case 'createRole':
          createdRoleId = await guild.createRole(a.name);
          report.created.push(`rola ${a.name}`);
          await storeAdminRole(db, createdRoleId);
          break;
        case 'adoptRole':
          await storeAdminRole(db, a.roleId);
          report.updated.push(`rola ${a.name} zapisana jako rola admina`);
          break;
        case 'assignRole': {
          const roleId = a.roleId ?? createdRoleId;
          if (!roleId) throw new Error(`brak roli ${a.roleName}`);
          await guild.addRoleToMember(a.userId, roleId);
          report.assignedRoleId = roleId;
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
          let unlinked = 0;
          if (!(await relinkFiles(db, first.files, thread))) {
            unlinked += first.files.length;
          }
          for (const m of rest) {
            const sent = await guild.sendMessage(thread.threadId, {
              content: m.content,
              files: m.uploads,
            });
            if (!(await relinkFiles(db, m.files, sent))) {
              unlinked += m.files.length;
            }
          }
          const n = prepared.reduce((k, m) => k + m.files.length, 0);
          report.created.push(`${a.code}: post „${a.title}” (${n} plików)`);
          if (unlinked > 0) {
            report.failures.push(unlinkedFiles(a.code, a.title, unlinked));
          }
          break;
        }
        case 'postFiles': {
          const prepared = [];
          for (const m of a.messages) {
            prepared.push({ ...m, uploads: await uploads(m.files) });
          }
          let unlinked = 0;
          for (const m of prepared) {
            const sent = await guild.sendMessage(a.threadId, {
              content: m.content,
              files: m.uploads,
            });
            if (!(await relinkFiles(db, m.files, sent))) {
              unlinked += m.files.length;
            }
          }
          const n = prepared.reduce((k, m) => k + m.files.length, 0);
          report.updated.push(`${a.code}: „${a.title}”: dosłano ${n} plików`);
          if (unlinked > 0) {
            report.failures.push(unlinkedFiles(a.code, a.title, unlinked));
          }
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
            report.created.push(`${a.code}: post informacyjny`);
            if (a.pin) {
              try {
                await guild.pinThread(t.threadId);
              } catch (err) {
                report.warnings.push(
                  `${a.code}: nie udało się przypiąć posta informacyjnego (${errText(err)})`,
                );
              }
            }
            break;
          }
          await guild.editMessage(e.threadId, e.messageId, a.content);
          report.updated.push(`${a.code}: post informacyjny`);
          break;
        }
        case 'ensurePanelChannel': {
          const keys = PANEL_SETTINGS[a.which];
          if (a.existingId !== null) {
            await setSetting(db, keys.channel, a.existingId);
            panelChannels[a.which] = a.existingId;
            report.updated.push(
              `kanał #${a.name} zapisany jako kanał panelu (uprawnienia bez zmian)`,
            );
            const adopted = snapshot.textChannels.find(
              (c) => c.id === a.existingId,
            );
            if (a.which === 'admin' && adopted?.everyoneCanView) {
              // Not a leak (every adm interaction re-checks the role), but
              // the admin panel is meant to be hidden.
              report.warnings.push(
                `kanał #${a.name} widzą wszyscy — ogranicz go do roli admina`,
              );
            }
            break;
          }
          const adminRoleId =
            a.which === 'admin'
              ? (createdRoleId ?? (await getSetting(db, ADMIN_ROLE_SETTING)))
              : null;
          if (a.which === 'admin' && adminRoleId === null) {
            throw new Error('brak roli admina — kanał nie został utworzony');
          }
          const id = await guild.createTextChannel({
            name: a.name,
            parentId: a.parentId,
            private: a.which === 'admin',
            adminRoleId,
          });
          await setSetting(db, keys.channel, id);
          panelChannels[a.which] = id;
          report.created.push(`kanał #${a.name}`);
          break;
        }
        case 'syncAdminPanelPerms': {
          const roleId = a.roleId ?? createdRoleId;
          if (!roleId) throw new Error('brak roli admina');
          await guild.syncAdminPanelPerms(a.channelId, roleId);
          report.updated.push(
            `kanał #${PANEL_CHANNEL_NAMES.admin}: uprawnienia dla roli admina`,
          );
          break;
        }
        case 'ensurePanelMessage': {
          const keys = PANEL_SETTINGS[a.which];
          const name = PANEL_CHANNEL_NAMES[a.which];
          const channelId = a.channelId ?? panelChannels[a.which];
          if (!channelId) throw new Error('brak kanału panelu');
          const view = PANEL_VIEWS[a.which]();
          const notPinned = () =>
            report.warnings.push(
              `nie udało się przypiąć panelu w #${name} (bot potrzebuje uprawnienia Pin Messages)`,
            );
          const edited =
            a.messageId !== null &&
            (await guild.editPanel(channelId, a.messageId, view));
          if (edited) {
            report.updated.push(`panel w #${name}`);
            if (!edited.pinned) notPinned();
            break;
          }
          const posted = await guild.postPanel(channelId, view);
          // Accepted risk: if storing the id fails, the next run cannot find
          // this message and posts a second panel.
          await setSetting(db, keys.message, posted.id);
          report.created.push(`panel w #${name}`);
          if (!posted.pinned) notPinned();
          break;
        }
        case 'warn':
          report.warnings.push(a.code ? `${a.code}: ${a.message}` : a.message);
          break;
      }
    } catch (err) {
      // A failed post only affects that topic; other failures stop the subject.
      if (
        'subjectId' in a &&
        a.type !== 'postTopic' &&
        a.type !== 'postFiles'
      ) {
        failedSubjects.add(a.subjectId);
      }
      const what = label || a.type;
      report.failures.push(`${what}: ${errText(err)}`);
    }
  }
  return report;
}
