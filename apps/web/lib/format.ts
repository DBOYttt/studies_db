const dateFmt = new Intl.DateTimeFormat('pl-PL', {
  dateStyle: 'medium',
  timeZone: 'Europe/Warsaw',
});

export const formatDate = (d: Date): string => dateFmt.format(d);

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const ROLE_LABELS: Record<string, string> = {
  wyklad: 'Wykład',
  cwiczenia: 'Ćwiczenia',
  laboratorium: 'Laboratorium',
  projekt: 'Projekt',
};
