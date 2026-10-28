import { EVENT_KINDS, type EventKind } from '@studies/db/constants';
import { EVENT_KIND_ICONS } from '@/lib/event-kind-icons';

/**
 * The kind of an event as a line icon. With `label`, the kind is also read
 * out (sr-only) for places where the icon stands alone.
 */
export function EventKindIcon({
  kind,
  size = 14,
  label = false,
  className,
}: {
  kind: EventKind;
  size?: number;
  label?: boolean;
  className?: string;
}) {
  const Icon = EVENT_KIND_ICONS[kind];
  return (
    <>
      <Icon
        size={size}
        aria-hidden
        className={`inline-block shrink-0 align-[-0.125em] ${className ?? ''}`}
      />
      {label && <span className="sr-only">{EVENT_KINDS[kind].label}: </span>}
    </>
  );
}
