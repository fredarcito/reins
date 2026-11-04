import 'server-only';
import type { Order } from '@/features/orders/types';

export const db = {
  orders: (): Order[] => [{ id: 'a1', total: 1000 }],
};
