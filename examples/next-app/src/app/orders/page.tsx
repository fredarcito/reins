import { Invoice } from '@/features/billing';
// VIOLATION domain-boundary: imports an internal file of the billing domain instead of its index.
import { taxFor } from '@/features/billing/tax';

export default function OrdersPage() {
  return <Invoice total={1000} tax={taxFor(1000)} />;
}
