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
    case 'warn':
      return `uwaga — ${a.code ? `${a.code}: ` : ''}${a.message}`;
  }
}

export function formatPlan(actions: Action[]): string {
  if (actions.length === 0) return UP_TO_DATE;
  return fitLines([
    'Plan (bez zmian):',
    ...actions.map((a) => `- ${describeAction(a)}`),
  ]);
}
