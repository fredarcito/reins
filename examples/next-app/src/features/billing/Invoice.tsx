import { Button } from '@/components/Button';
import { formatDate } from '@/lib/date';

export type InvoiceLine = { label: string; amount: number };

export function Invoice({ total, tax }: { total: number; tax: number }) {
  return <Button>{formatDate(new Date())}: {total + tax}</Button>;
}
