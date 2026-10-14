import { CLASS_NAMES } from '@studies/db/constants';
import type { SetupReport } from './apply.js';
import type { Action } from './types.js';

const MAX_LEN = 2000;
const UP_TO_DATE = 'Wszystko jest aktualne.';

function fitLines(lines: string[]): string {
  let out = '';
  for (const [i, line] of lines.entries()) {
    const more = `\n… i ${lines.length - i} więcej`;
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
    ...section('Utworzono', r.created),
    ...section('Zaktualizowano', r.updated),
    ...section('Ostrzeżenia', r.warnings),
    ...section('Błędy', r.failures),
  ];
  return lines.length === 0 ? UP_TO_DATE : fitLines(lines);
}

function describeAction(a: Action): string {
  switch (a.type) {
    case 'createRole':
      return `utwórz rolę ${a.name}`;
    case 'adoptRole':
      return `zapisz rolę ${a.name} jako rolę admina`;
    case 'assignRole':
      return `nadaj Ci rolę ${a.roleName}`;
    case 'createCategory':
      return `utwórz kategorię ${a.name}`;
    case 'createForum':
      return `${a.code}: utwórz forum #${a.name} (${a.categoryName}) z tagami ${a.tags.join(', ')}`;
    case 'addTags':
      return `${a.code}: dodaj tagi ${a.tags.join(', ')}`;
    case 'setGuidelines':
      return `${a.code}: zaktualizuj wytyczne forum`;
    case 'importForum':
      return `${a.code}: dodaj do bazy przedmiot „${a.name}” (sem. ${a.semester}) z forum #${a.forumName}${a.classKinds.length > 0 ? ` z zajęciami ${a.classKinds.map((k) => CLASS_NAMES[k]).join(', ')}` : ''}`;
    case 'addClasses':
      return `${a.code}: dodaj do bazy zajęcia ${a.kinds.map((k) => CLASS_NAMES[k]).join(', ')}`;
    case 'postTopic': {
      const n = a.messages.reduce((k, m) => k + m.files.length, 0);
      return `${a.code}: opublikuj temat „${a.title}” (${n} plików)`;
    }
    case 'postFiles': {
      const n = a.messages.reduce((k, m) => k + m.files.length, 0);
      return `${a.code}: doślij ${n} plików do tematu „${a.title}”`;
    }
    case 'upsertInfoPost':
      return `${a.code}: ${a.existing ? 'zaktualizuj' : 'utwórz'} post informacyjny`;
    case 'warn':
      return `uwaga — ${a.code ? `${a.code}: ` : ''}${a.message}`;
  }
}

export function formatPlan(actions: Action[]): string {
  if (actions.length === 0) return UP_TO_DATE;
  const note = actions.some((a) => a.type === 'importForum')
    ? [
        'Po imporcie /setup pobierze posty z tych forów i doda im tagi i wytyczne.',
      ]
    : [];
  return fitLines([
    'Plan (bez zmian):',
    ...actions.map((a) => `- ${describeAction(a)}`),
    ...note,
  ]);
}
