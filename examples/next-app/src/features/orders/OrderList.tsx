'use client';
// VIOLATION next-server-client: this client component reaches src/lib/db.ts (server-only) through queries.ts.
import { OrderBadge } from '@/components/OrderBadge';
import { recentOrders } from './queries';

export function OrderList() {
  return recentOrders().map((o) => <OrderBadge key={o.id} order={o} />);
}
