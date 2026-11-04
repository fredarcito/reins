import { formatDate } from './date';
// Type-only import from an upper layer: ignored by layer-direction (ignore_kinds: [type]).
import type { InvoiceLine } from '@/features/billing';

export const now = () => new Date();
export const stamp = (line?: InvoiceLine) => `${formatDate(now())} ${line?.label ?? ''}`;
