export type PreviewKind = 'pdf' | 'image' | 'text' | 'none';
export type JobType = 'convert' | 'extract_text';

const OFFICE_EXTS = new Set([
  'doc',
  'docx',
  'odt',
  'rtf',
  'ppt',
  'pptx',
  'odp',
  'xls',
  'xlsx',
  'ods',
]);
const TEXT_EXTS = new Set([
  'txt',
  'md',
  'csv',
  'json',
  'xml',
  'yaml',
  'yml',
  'c',
  'h',
  'cpp',
  'hpp',
  'py',
  'js',
  'ts',
  'java',
  'm',
  'tex',
  'log',
  'ini',
]);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

export function fileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot <= 0 || dot === filename.length - 1) return '';
  return filename.slice(dot + 1).toLowerCase();
}

export function planProcessing(
  filename: string,
  mime: string,
): { previewKind: PreviewKind; jobs: JobType[] } {
  const ext = fileExtension(filename);

  if (ext === 'pdf' || mime === 'application/pdf') {
    return { previewKind: 'pdf', jobs: ['extract_text'] };
  }
  if (OFFICE_EXTS.has(ext)) {
    return { previewKind: 'pdf', jobs: ['convert'] };
  }
  if (
    TEXT_EXTS.has(ext) ||
    (!IMAGE_EXTS.has(ext) && mime.startsWith('text/'))
  ) {
    return { previewKind: 'text', jobs: ['extract_text'] };
  }
  if (IMAGE_EXTS.has(ext) || mime.startsWith('image/')) {
    return { previewKind: 'image', jobs: [] };
  }
  return { previewKind: 'none', jobs: [] };
}

export function originalRelPath(sha256: string, ext: string): string {
  return ext === '' ? `originals/${sha256}` : `originals/${sha256}.${ext}`;
}

export function previewRelPath(sha256: string): string {
  return `previews/${sha256}.pdf`;
}
