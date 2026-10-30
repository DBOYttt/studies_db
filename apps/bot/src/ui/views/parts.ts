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

/** `S<n> · <code> <name>` past 25 subjects (the semester orients), else `<code> <name>`. */
export const subjectOptionLabel = (
  s: { code: string; name: string; semester: number },
  total: number,
): string =>
  clip(
    total > 25 ? `S${s.semester} · ${s.code} ${s.name}` : `${s.code} ${s.name}`,
  );

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
