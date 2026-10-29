/**
 * Admin panel modals. Field ids are the slash-command option names, and max
 * lengths come from the same constants as `commands/definitions.ts`. Stored
 * values are prefilled (clipped to the field limit Discord enforces).
 *
 * A modal holds at most 5 fields, so a new subject has no platform URL (like
 * `/subject add`) and an existing one has no code field (the code is fixed).
 */
import {
  ASSESSMENT_NAMES,
  ASSESSMENTS,
  type Assessment,
  CLASS_NAMES,
  type ClassKind,
} from '@studies/db';
import {
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  ECTS_MAX,
  ECTS_MIN,
  FIELD_MAX,
  SEMESTERS,
} from '../../commands/fields.js';
import { encodeId } from '../ids.js';
import type { LecturerCardData, SubjectCardData } from './admin.js';

export interface FieldSpec {
  id: string;
  label: string;
  max: number;
  value?: string | null;
  required?: boolean;
  long?: boolean;
  placeholder?: string;
}

/**
 * The prefilled value of a field: `value` cut to `max` UTF-16 units without
 * splitting a surrogate pair. A submitted value equal to it is unchanged.
 */
export function prefill(value: string | null | undefined, max: number): string {
  if (!value) return '';
  let out = '';
  for (const ch of value) {
    if (out.length + ch.length > max) break;
    out += ch;
  }
  return out;
}

export function field(f: FieldSpec): LabelBuilder {
  const input = new TextInputBuilder()
    .setCustomId(f.id)
    .setStyle(f.long ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setMaxLength(f.max)
    .setRequired(f.required ?? false);
  const value = prefill(f.value, f.max);
  if (value) input.setValue(value);
  if (f.placeholder) input.setPlaceholder(f.placeholder);
  return new LabelBuilder().setLabel(f.label).setTextInputComponent(input);
}

export const modal = (id: string, title: string, fields: LabelBuilder[]) =>
  new ModalBuilder().setCustomId(id).setTitle(title).addLabelComponents(fields);

/** `adm:subj:save:<code|new>`. */
export function subjectModal(
  s?: Pick<
    SubjectCardData,
    'code' | 'name' | 'semester' | 'ects' | 'description' | 'platformUrl'
  >,
): ModalBuilder {
  const fields = [
    field({
      id: 'name',
      label: 'Name',
      max: FIELD_MAX.subjectName,
      value: s?.name,
      required: true,
    }),
  ];
  if (!s) {
    fields.push(
      field({
        id: 'code',
        label: 'Code',
        max: FIELD_MAX.subjectCode,
        required: true,
      }),
    );
  }
  fields.push(
    field({
      id: 'semester',
      label: `Semester (${SEMESTERS.join(' or ')})`,
      max: String(Math.max(...SEMESTERS)).length,
      value: s ? String(s.semester) : null,
      required: true,
    }),
    field({
      id: 'ects',
      label: `ECTS points (${ECTS_MIN}–${ECTS_MAX})`,
      max: String(ECTS_MAX).length,
      value: s ? String(s.ects) : null,
      required: true,
    }),
    field({
      id: 'description',
      label: 'Description',
      max: FIELD_MAX.description,
      value: s?.description,
      long: true,
    }),
  );
  if (s) {
    fields.push(
      field({
        id: 'platform_url',
        label: 'Platform URL',
        max: FIELD_MAX.platformUrl,
        value: s.platformUrl,
        placeholder: 'https://…',
      }),
    );
  }
  return modal(
    encodeId('adm', 'subj', 'save', s ? s.code : 'new'),
    s ? `Edit subject ${s.code}` : 'New subject',
    fields,
  );
}

/** `adm:class:save:<code>:<kind>`; assessment `brak` clears it. */
export function classModal(
  code: string,
  kind: ClassKind,
  current: {
    assessment: Assessment | null;
    assessmentNote: string | null;
    platformUrl: string | null;
  },
): ModalBuilder {
  const assessment = new StringSelectMenuBuilder()
    .setCustomId('assessment')
    .setRequired(true)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('None')
        .setValue('brak')
        .setDefault(current.assessment === null),
      ...ASSESSMENTS.map((a) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(ASSESSMENT_NAMES[a])
          .setValue(a)
          .setDefault(a === current.assessment),
      ),
    );
  return modal(
    encodeId('adm', 'class', 'save', code, kind),
    `${code} · ${CLASS_NAMES[kind]}`,
    [
      new LabelBuilder()
        .setLabel('Assessment')
        .setStringSelectMenuComponent(assessment),
      field({
        id: 'note',
        label: 'Notes',
        max: FIELD_MAX.classNote,
        value: current.assessmentNote,
        long: true,
      }),
      field({
        id: 'platform_url',
        label: 'Platform URL',
        max: FIELD_MAX.platformUrl,
        value: current.platformUrl,
        placeholder: 'https://…',
      }),
    ],
  );
}

/** `adm:lect:save:<id|new>`. */
export function lecturerModal(l?: LecturerCardData): ModalBuilder {
  return modal(
    encodeId('adm', 'lect', 'save', l ? l.id : 'new'),
    l ? 'Edit lecturer' : 'New lecturer',
    [
      field({
        id: 'name',
        label: 'Full name',
        max: FIELD_MAX.lecturerName,
        value: l?.name,
        required: true,
      }),
      field({
        id: 'title',
        label: 'Title',
        max: FIELD_MAX.lecturerTitle,
        value: l?.title,
        placeholder: 'dr',
      }),
      field({
        id: 'email',
        label: 'Email',
        max: FIELD_MAX.email,
        value: l?.email,
      }),
      field({
        id: 'office_hours',
        label: 'Office hours',
        max: FIELD_MAX.officeHours,
        value: l?.officeHours,
        long: true,
      }),
      field({
        id: 'room',
        label: 'Room',
        max: FIELD_MAX.room,
        value: l?.room,
      }),
    ],
  );
}

/** `stu:groups:importsubmit`: the personal UniTime calendar link. */
export const groupImportModal = () =>
  modal(encodeId('stu', 'groups', 'importsubmit'), 'Import from UniTime', [
    field({
      id: 'url',
      label: 'UniTime calendar link',
      max: 500,
      required: true,
      placeholder: 'https://plan.agh.edu.pl/...',
    }),
  ]);
