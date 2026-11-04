// VIOLATION layer-direction: a component (lower layer) imports from features (upper layer).
import { OrderList } from '@/features/orders';

export function OrdersLink() {
  return <a href="/orders">{typeof OrderList}</a>;
}
