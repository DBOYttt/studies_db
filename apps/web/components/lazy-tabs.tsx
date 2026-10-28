'use client';

// Heavy client components that a tabbed page shows on one tab only. Loading
// them through next/dynamic from a client module keeps CodeMirror, React Flow
// and dagre out of the route's first load: the chunks are fetched only when
// the tab that renders them is open. (A dynamic import in a Server Component
// would not split the client bundle.)
import dynamic from 'next/dynamic';

const loading = () => (
  <p className="text-sm text-[var(--muted)]" role="status">
    Loading…
  </p>
);

export const LazySqlConsole = dynamic(
  () => import('@/components/SqlConsole').then((m) => m.SqlConsole),
  { loading },
);

export const LazyDataMap = dynamic(
  () => import('@/components/explorer/DataMap').then((m) => m.DataMap),
  { loading },
);

export const LazyDesignerDiagram = dynamic(
  () => import('@/components/DesignerDiagram').then((m) => m.DesignerDiagram),
  { loading },
);
