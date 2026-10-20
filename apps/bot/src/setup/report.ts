import { plural } from '@studies/db';
import { CLASS_NAMES } from '@studies/db/constants';
import type { SetupReport } from './apply.js';
import { PANEL_CHANNEL_NAMES } from './plan.js';
import type { Action } from './types.js';

const MAX_LEN = 2000;
const UP_TO_DATE = 'Everything is up to date.';

function fitLines(lines: string[]): string {
  let out = '';
  for (const [i, line] of lines.entries()) {
    const more = `\n… and ${lines.length - i} more`;
    const next = out ? `${out}\n${line}` : line;
    if (next.length + more.length > MAX_LEN) return `${out}${more}`;
    out = next;
  }
  return out;
}

const section = (title: string, items: string[]) =>
  items.length > 0 ? [`**${title}**`, ...items.map((i) => `- ${i}`)] : [];

export function mergeReports(a: SetupReport, b: SetupReport): SetupReport {
  return {
    created: [...a.created, ...b.created],
    updated: [...a.updated, ...b.updated],
    warnings: [...a.warnings, ...b.warnings],
    failures: [...a.failures, ...b.failures],
    assignedRoleId: b.assignedRoleId ?? a.assignedRoleId,
  };
}

export function formatReport(r: SetupReport): string {
  const lines = [
    ...section('Created', r.created),
    ...section('Updated', r.updated),
    ...section('Warnings', r.warnings),
    ...section('Errors', r.failures),
  ];
  return lines.length === 0 ? UP_TO_DATE : fitLines(lines);
}

function describeAction(a: Action): string {
  switch (a.type) {
    case 'createRole':
      return `create role ${a.name}`;
    case 'adoptRole':
      return `save role ${a.name} as the admin role`;
    case 'assignRole':
      return `give you the role ${a.roleName}`;
    case 'createCategory':
      return `create category ${a.name}`;
    case 'createForum':
      return `${a.code}: create forum #${a.name} (${a.categoryName}) with tags ${a.tags.join(', ')}`;
    case 'addTags':
      return `${a.code}: add tags ${a.tags.join(', ')}`;
    case 'setGuidelines':
      return `${a.code}: update the forum guidelines`;
    case 'importForum':
      return `${a.code}: add subject "${a.name}" (sem. ${a.semester}) to the database from forum #${a.forumName}${a.classKinds.length > 0 ? ` with classes ${a.classKinds.map((k) => CLASS_NAMES[k]).join(', ')}` : ''}`;
    case 'addClasses':
      return `${a.code}: add classes to the database: ${a.kinds.map((k) => CLASS_NAMES[k]).join(', ')}`;
    case 'postTopic': {
      const n = a.messages.reduce((k, m) => k + m.files.length, 0);
      return `${a.code}: post topic "${a.title}" (${plural(n, 'file', 'files')})`;
    }
    case 'postFiles': {
      const n = a.messages.reduce((k, m) => k + m.files.length, 0);
      return `${a.code}: send ${plural(n, 'more file', 'more files')} to topic "${a.title}"`;
    }
    case 'upsertInfoPost':
      return `${a.code}: ${a.existing ? (a.existing.renameTo ? 'rename and update' : 'update') : 'create'} the info post`;
    case 'ensurePanelChannel':
      return a.existingId
        ? `save channel #${a.name} as a panel channel`
        : `create channel #${a.name}`;
    case 'syncAdminPanelPerms':
      return `set permissions of #${PANEL_CHANNEL_NAMES.admin} for the admin role`;
    case 'ensurePanelMessage':
      return a.messageId
        ? `refresh the panel in #${PANEL_CHANNEL_NAMES[a.which]} (or post it again if it is gone)`
        : `post the panel in #${PANEL_CHANNEL_NAMES[a.which]}`;
    case 'ensureEventsForum':
      return a.existingId
        ? `${a.code}: save the existing forum as the events forum`
        : `${a.code}: create forum #${a.name} with tags ${a.tags.join(', ')}`;
    case 'setEventsForumTopic':
      return `${a.code}: update the forum description`;
    case 'addEventsTags':
      return `${a.code}: add tags ${a.tags.join(', ')}`;
    case 'upsertEventsInfoPost':
      return `${a.code}: ${a.existing ? (a.existing.renameTo ? 'rename and update' : 'update') : 'create'} the info post`;
    case 'warn':
      return `warning: ${a.code ? `${a.code}: ` : ''}${a.message}`;
  }
}

export function formatPlan(actions: Action[]): string {
  if (actions.length === 0) return UP_TO_DATE;
  const note = actions.some((a) => a.type === 'importForum')
    ? [
        'After the import, /setup will fetch the posts from those forums and add tags and guidelines to them.',
      ]
    : [];
  return fitLines([
    'Plan (no changes made):',
    ...actions.map((a) => `- ${describeAction(a)}`),
    ...note,
  ]);
}
