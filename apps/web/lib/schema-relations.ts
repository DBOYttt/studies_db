import type { PublicView } from '@studies/db/constants';
import type { ExplorerParams } from './explorer';

export type SchemaRelation = {
  from: { view: PublicView; column: string };
  to: { view: PublicView; column: string };
};

const rel = (
  fromView: PublicView,
  fromColumn: string,
  toView: PublicView,
  toColumn: string,
): SchemaRelation => ({
  from: { view: fromView, column: fromColumn },
  to: { view: toView, column: toColumn },
});

/** Foreign-key style links between the public views, for the schema diagram. */
export const SCHEMA_RELATIONS: SchemaRelation[] = [
  rel('v_classes', 'subject_id', 'v_subjects', 'id'),
  rel('v_class_groups', 'class_id', 'v_classes', 'id'),
  rel('v_class_lecturers', 'class_id', 'v_classes', 'id'),
  rel('v_class_lecturers', 'lecturer_id', 'v_lecturers', 'id'),
  rel('v_class_lecturers', 'group_id', 'v_class_groups', 'id'),
  rel('v_topics', 'subject_id', 'v_subjects', 'id'),
  rel('v_topics', 'class_id', 'v_classes', 'id'),
  rel('v_topics', 'group_id', 'v_class_groups', 'id'),
  rel('v_topics', 'created_by', 'v_users', 'id'),
  rel('v_topic_tags', 'topic_id', 'v_topics', 'id'),
  rel('v_topic_tags', 'tag_id', 'v_tags', 'id'),
  rel('v_tags', 'subject_id', 'v_subjects', 'id'),
  rel('v_materials', 'topic_id', 'v_topics', 'id'),
  rel('v_materials', 'uploader_id', 'v_users', 'id'),
  rel('v_files', 'topic_id', 'v_topics', 'id'),
  rel('v_files', 'material_id', 'v_materials', 'id'),
  rel('v_class_sessions', 'subject_id', 'v_subjects', 'id'),
  rel('v_class_sessions', 'class_id', 'v_classes', 'id'),
  rel('v_class_sessions', 'group_id', 'v_class_groups', 'id'),
  rel('v_class_sessions', 'lecturer_id', 'v_lecturers', 'id'),
];

export type SelectionNames = {
  subject?: string;
  subjectId?: number;
  className?: string;
  classId?: number | null;
  groupName?: string;
  groupId?: number;
};

const withId = (text: string, id: number | null | undefined) =>
  id == null ? text : `${text} (id ${id})`;

/**
 * Views the current Explorer selection lives in, plus a caption for the
 * deepest level, suffixed with that row's id. Topic and file captions are
 * generic on purpose: user text (titles, filenames) is never put into the
 * caption, only ids.
 */
export function selectionPath(
  sel: ExplorerParams,
  names: SelectionNames,
): { views: PublicView[]; caption: string | null } {
  const views: PublicView[] = ['v_subjects'];
  let caption = withId(
    `${names.subject ?? 'Subject'} is in v_subjects`,
    names.subjectId,
  );
  if (sel.classKind && sel.classKind !== 'none') {
    views.push('v_classes');
    caption = withId(
      `${names.className ?? 'Class'} is in v_classes`,
      names.classId,
    );
  }
  if (sel.group != null) {
    views.push('v_class_groups');
    caption = withId(
      `${names.groupName ?? 'Group'} is in v_class_groups`,
      names.groupId,
    );
  }
  if (sel.topic != null) {
    views.push('v_topics');
    caption = withId('Topic is in v_topics', sel.topic);
  }
  if (sel.file != null) {
    views.push('v_materials', 'v_files');
    caption = withId('File is in v_materials and v_files', sel.file);
  }
  return { views, caption };
}
