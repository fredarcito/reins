#!/usr/bin/env node
// Packs every harness package into .tarballs/ (gitignored) so the team can install them without publishing.
// pnpm pack turns "workspace:^" into real version ranges.
// Usage: pnpm pack:all
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = path.join(root, '.tarballs');
const packages = ['packages/core', 'packages/cli', ...readdirSync(path.join(root, 'packages/adapters')).map((d) => `packages/adapters/${d}`)];

rmSync(out, { recursive: true, force: true });
mkdirSync(out);
for (const dir of packages) {
  const { name, version } = JSON.parse(readFileSync(path.join(root, dir, 'package.json'), 'utf8'));
  execFileSync('pnpm', ['pack', '--pack-destination', out], { cwd: path.join(root, dir), stdio: 'ignore' });
  console.log(`${name}@${version}`);
}
console.log(`\nTarballs in ${out}:`);
for (const f of readdirSync(out).sort()) console.log(`  ${path.join(out, f)}`);
