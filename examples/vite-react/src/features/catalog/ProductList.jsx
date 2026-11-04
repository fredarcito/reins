import { Button } from '@/components/Button';
import { formatPrice } from '@/lib/format';

export function ProductList({ load }) {
  const products = load();
  return products.map((p) => <Button key={p.id}>{p.name} {formatPrice(p.price)}</Button>);
}
