const LABELS = {
  pending: [
    'Przetwarzanie…',
    'border-amber-500 text-amber-700 dark:text-amber-300',
  ],
  failed: [
    'Podgląd niedostępny',
    'border-red-500 text-red-700 dark:text-red-300',
  ],
  ready: [
    'Gotowe',
    'border-emerald-500 text-emerald-700 dark:text-emerald-300',
  ],
} as const;

export function StatusBadge({ status }: { status: keyof typeof LABELS }) {
  const [label, cls] = LABELS[status];
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {label}
    </span>
  );
}
