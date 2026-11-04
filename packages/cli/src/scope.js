import { readFileSync } from 'node:fs';

/** This package's package.json. */
export const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * npm scope of the other reins packages (core, adapters), derived from this package's dependency on
 * <scope>/core (never hardcoded). The CLI itself is unscoped, so that `npx reins` finds it.
 */
export const SCOPE = Object.keys(pkg.dependencies ?? {}).find((n) => /^@[^/]+\/core$/.test(n))?.split('/')[0] ?? '@reins';
