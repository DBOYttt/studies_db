import type { Icon } from '@phosphor-icons/react';
import {
  Bus,
  CalendarPlus,
  Exam,
  GraduationCap,
  PushPin,
} from '@phosphor-icons/react/dist/ssr';
import type { EventKind } from '@studies/db/constants';

/**
 * Line icon of each event kind on the web. The Discord bot keeps the emoji
 * in `EVENT_KINDS[k].symbol`.
 */
export const EVENT_KIND_ICONS: Record<EventKind, Icon> = {
  kolokwium: Exam,
  egzamin: GraduationCap,
  wyjazd: Bus,
  zajecia_dodatkowe: CalendarPlus,
  inne: PushPin,
};
