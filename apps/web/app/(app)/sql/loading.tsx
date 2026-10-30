// Loading UI for this segment only. It is not at the route group root on
// purpose: a fallback that renders before a page's notFound() turns the 404
// into a streamed 200, so pages that can 404 or redirect (admin, entity
// pages, /tables/<view>, /) stay unwrapped. Simple mode has no loading.tsx:
// each simple page draws its own SimpleShell, and a fallback would swap that
// frame for a fake one; /s and /s/plan stream their slow parts under
// <Suspense> instead. Static: no data, no gate.
export { AppPaneSkeleton as default } from '@/components/Skeleton';
