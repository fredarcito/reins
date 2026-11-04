import { ProductList } from '@/features/catalog';
import { CartSummary } from '@/features/cart';
// VIOLATION domain-boundary: imports an internal file of the catalog domain instead of its index.
import { fetchProducts } from '@/features/catalog/api';

export function Home() {
  return (
    <main>
      <ProductList load={fetchProducts} />
      <CartSummary />
    </main>
  );
}
