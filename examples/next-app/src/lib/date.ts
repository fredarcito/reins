// VIOLATION no-cycles: date.ts -> time.ts -> date.ts
import { now } from './time';

export const formatDate = (d: Date = now()) => d.toISOString().slice(0, 10);
