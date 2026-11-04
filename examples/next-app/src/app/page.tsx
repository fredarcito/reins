import { OrderList } from '@/features/orders';
import { OrdersLink } from '@/components/OrdersLink';

export default function Page() {
  return (
    <>
      <OrdersLink />
      <OrderList />
    </>
  );
}
