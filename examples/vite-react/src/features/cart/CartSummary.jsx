import { PriceTag } from '@/components/PriceTag';
import { useCart } from './cartStore';

export function CartSummary() {
  const { total } = useCart();
  return <PriceTag amount={total} />;
}
