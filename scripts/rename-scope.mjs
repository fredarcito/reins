#!/usr/bin/env node
// Renames the npm scope of every reins package (e.g. @reins -> @acme).
// The current scope is read from packages/core/package.json, which is the single source of truth.
// Runtime code never hardcodes the scope except in import specifiers, which this script rewrites.
//
// Usage: node scripts/rename-scope.mjs <@new-scope> [--dry-run]
// After a real run: pnpm install (to refresh pnpm-lock.yaml) and pnpm test.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage']);
const TEXT_EXT = /\.(m?js|cjs|json|md|ya?ml|sh)$/;
// Historical records: they describe what was tested under the old name.
const SKIP_FILES = new Set(['docs/DESIGN.md', 'docs/VERIFIED.md', 'pnpm-lock.yaml']);
const SKIP_PREFIXES = ['scripts/verify/'];

export const SCOPE_RE = /^@[a-z0-9][a-z0-9._-]*$/;

/** @param {string} root */
export function currentScope(root) {
  const name = JSON.parse(readFileSync(path.join(root, 'packages/core/package.json'), 'utf8')).name;
  return name.split('/')[0];
}

/** @param {string} dir @param {string} root @returns {string[]} */
function walk(dir, root) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    const r = path.relative(root, full).split(path.sep).join('/');
    if (statSync(full).isDirectory()) out.push(...walk(full, root));
    else if (TEXT_EXT.test(entry) && !SKIP_FILES.has(r) && !SKIP_PREFIXES.some((p) => r.startsWith(p))) out.push(full);
  }
  return out;
}

/**
 * @param {string} root repo root
 * @param {string} next new scope, e.g. "@acme"
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {{ from: string, to: string, files: string[] }} files that change (relative paths)
 */
export function renameScope(root, next, opts = {}) {
  if (!SCOPE_RE.test(next)) throw new Error(`Invalid scope "${next}". Expected something like @acme.`);
  const from = currentScope(root);
  if (from === next) return { from, to: next, files: [] };
  // "<scope>/" with the slash, so a longer scope like "@reins-x/" is not touched.
  const re = new RegExp(`${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`, 'g');
  const files = [];
  for (const file of walk(root, root)) {
    const text = readFileSync(file, 'utf8');
    const updated = text.replace(re, `${next}/`);
    if (updated !== text) {
      files.push(path.relative(root, file).split(path.sep).join('/'));
      if (!opts.dryRun) writeFileSync(file, updated);
    }
  }
  return { from, to: next, files };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { 'dry-run': { type: 'boolean' } } });
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  if (positionals.length !== 1 || !existsSync(path.join(root, 'packages/core/package.json'))) {
    console.error('Usage: node scripts/rename-scope.mjs <@new-scope> [--dry-run]');
    process.exit(2);
  }
  try {
    const r = renameScope(root, positionals[0], { dryRun: values['dry-run'] });
    console.log(`${values['dry-run'] ? '[dry run] ' : ''}${r.from} -> ${r.to}: ${r.files.length} file(s)`);
    for (const f of r.files) console.log(`  ${f}`);
    if (!values['dry-run'] && r.files.length) console.log('Next: pnpm install && pnpm test');
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}
