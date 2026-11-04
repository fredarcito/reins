// Type-only import from an upper layer: ignored (ignore_kinds: [type]).
import type { Order } from '@/features/orders';

export function OrderBadge({ order }: { order: Order }) {
  return <span>{order.id}</span>;
}
