/**
 * Building blocks shared by the student and admin views (Components V2).
 */
import {
  ActionRowBuilder,
  type AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  type ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
} from 'discord.js';
import { MAX_ID, MAX_TEXT } from '../limits.js';

export type ViewComponent = ContainerBuilder | TextDisplayBuilder;

export interface View {
  components: ViewComponent[];
  flags: MessageFlags.IsComponentsV2;
  /** Files the components show (`attachment://<name>`). */
  files?: AttachmentBuilder[];
}

export const view = (...components: ViewComponent[]): View => ({
  components,
  flags: MessageFlags.IsComponentsV2,
});

/** Cuts `s` to `n` characters, ending with "…" when cut. */
export const clip = (s: string, n = MAX_ID) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

/** `S<n> · <code> <name>` when `prefix` (the semester orients), else `<code> <name>`. */
export const subjectOptionLabel = (
  s: { code: string; name: string; semester: number },
  prefix: boolean | number,
  nameOnly = false,
): string => {
  const base = nameOnly ? s.name : `${s.code} ${s.name}`;
  const on = typeof prefix === 'number' ? prefix > 25 : prefix;
  return clip(on ? `S${s.semester} · ${base}` : base);
};

/**
 * Whether a subject list needs the `S<n> · ` prefix to be told apart: more
 * than 25 subjects, more than one semester, or two subjects with one name.
 */
export const needsSemesterPrefix = (
  subjects: { name: string; semester: number }[],
): boolean =>
  subjects.length > 25 ||
  new Set(subjects.map((s) => s.semester)).size > 1 ||
  new Set(subjects.map((s) => s.name)).size < subjects.length;

export const chunk = <T>(xs: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) =>
    xs.slice(i * n, i * n + n),
  );

export const text = (content: string) =>
  new TextDisplayBuilder().setContent(content);
export const divider = () =>
  new SeparatorBuilder()
    .setDivider(true)
    .setSpacing(SeparatorSpacingSize.Small);
export const button = (
  id: string,
  label: string,
  style = ButtonStyle.Secondary,
) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
export const linkButton = (url: string, label: string) =>
  new ButtonBuilder().setURL(url).setLabel(label).setStyle(ButtonStyle.Link);
export const row = (...buttons: ButtonBuilder[]) =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);

/** A single text message (errors and info). */
export function notice(content: string): View {
  return view(text(clip(content, MAX_TEXT)));
}
