// VIOLATION no-cycles: format.js -> currency.js -> format.js
import { CURRENCY } from './currency';

export const formatPrice = (cents) => `${(cents / 100).toFixed(2)} ${CURRENCY}`;
export const DEFAULT_LOCALE = 'en';
