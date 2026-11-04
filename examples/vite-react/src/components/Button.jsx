// VIOLATION layer-direction: a component (lower layer) imports from features (upper layer).
import { useCart } from '@/features/cart';

export function Button({ children }) {
  const { total } = useCart();
  return <button type="button" data-cart={total}>{children}</button>;
}
