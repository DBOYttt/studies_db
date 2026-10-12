import {
  File,
  FileCode,
  FileDoc,
  FileImage,
  FilePdf,
  FilePpt,
  FileText,
  FileXls,
} from '@phosphor-icons/react/dist/ssr';
import { type FileIconTone, fileIcon } from '@/lib/simple';

const ICONS = {
  FilePdf,
  FileImage,
  FileDoc,
  FilePpt,
  FileXls,
  FileText,
  FileCode,
  File,
} as const;

export const TONE: Record<FileIconTone, string> = {
  red: 'text-err-fg',
  green: 'text-ok-fg',
  accent: 'text-accent-ink',
  warn: 'text-warn-fg',
  muted: 'text-faint',
};

/** Icon of a file by MIME type and extension; colour via the parent unless `toned`. */
export function FileTypeIcon({
  file,
  size,
  toned,
}: {
  file: Parameters<typeof fileIcon>[0];
  size: number;
  toned?: boolean;
}) {
  const { icon, tone } = fileIcon(file);
  const Icon = ICONS[icon];
  return (
    <Icon size={size} className={toned ? TONE[tone] : undefined} aria-hidden />
  );
}
