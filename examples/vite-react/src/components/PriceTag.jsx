import { formatPrice } from '@/lib/format';

export function PriceTag({ amount }) {
  return <span>{formatPrice(amount)}</span>;
}
