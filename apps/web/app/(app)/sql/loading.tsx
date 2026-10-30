// Loading UI for this segment only. It is not at the route group root on
// purpose: a fallback that renders before a page's notFound() turns the 404
// into a streamed 200, so pages that can 404 or redirect (admin, entity
// pages, /tables/<view>, /) stay unwrapped. Static: no data, no gate.
export { AppPaneSkeleton as default } from '@/components/Skeleton';
