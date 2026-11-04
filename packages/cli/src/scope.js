import { readFileSync } from 'node:fs';

/** This package's package.json. */
export const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** npm scope of the harness packages, derived from this package's own name (never hardcoded). */
export const SCOPE = pkg.name.split('/')[0];
