import { db } from '@/lib/db';
import type { Order } from './types';

export function recentOrders(): Order[] {
  return db.orders();
}
