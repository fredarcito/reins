#!/usr/bin/env node
// Self-check of this repo's architecture, in two independent ways (the chicken-and-egg problem: a broken harness
// can't be trusted to validate itself):
//   1. dependency-cruiser alone, with plain forbidden rules (no harness code involved);
//   2. the harness's own `harness check`, run from source, plus a guard that it actually sees cross-package edges.
// Usage: pnpm self-check
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const adapterDir = path.join(root, 'packages/adapters/js');
// dependency-cruiser is ESM-only (no require.resolve); load it from the adapter that depends on it
const { cruise } = await import(pathToFileURL(path.join(adapterDir, 'node_modules/dependency-cruiser/src/main/index.mjs')).href);
let failed = false;

// 1. dependency-cruiser alone
const SRC = '^packages/(core|cli|adapters/[^/]+)/(src|rules)/';
const forbidden = [
  { name: 'core-imports-cli-or-adapters', severity: 'error', from: { path: '^packages/core/src/' }, to: { path: '^packages/(cli|adapters)/' } },
  { name: 'adapters-import-cli', severity: 'error', from: { path: '^packages/adapters/' }, to: { path: '^packages/cli/' } },
  { name: 'adapters-use-only-the-contract', severity: 'error', from: { path: '^packages/adapters/[^/]+/(src|rules)/' }, to: { path: '^packages/core/src/', pathNot: '^packages/core/src/contract/' } },
  { name: 'no-cycles', severity: 'error', from: { path: SRC }, to: { circular: true } },
];
const result = await cruise(['packages'], {
  baseDir: root,
  exclude: { path: '(^|/)(node_modules|test)/' },
  doNotFollow: { path: 'node_modules' },
  enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default'] },
  validate: true,
  ruleSet: { forbidden },
});
const out = result.output;
const crossPackage = out.modules.flatMap((m) => m.dependencies.filter((d) => /^packages\/cli\//.test(m.source) && /^packages\/core\//.test(d.resolved))).length;
if (out.summary.error > 0) {
  failed = true;
  for (const v of out.summary.violations) console.error(`✖ ${v.rule.name}: ${v.from} → ${v.to}`);
}
if (crossPackage === 0) {
  failed = true;
  console.error('✖ dependency-cruiser sees no cli → core imports: the resolution is broken, the check would be meaningless.');
}
console.log(`1. dependency-cruiser: ${out.summary.totalCruised} modules, ${out.summary.error} errors, ${crossPackage} cli → core imports seen.`);

// 2. harness check from source, and a guard against an empty graph
const adapter = (await import(pathToFileURL(path.join(adapterDir, 'src/index.js')).href)).default;
const graph = await adapter.graph(root, { ignore: ['examples/**', 'packages/*/test/fixtures/**', 'packages/adapters/*/test/fixtures/**'] });
const harnessCross = graph.edges.filter((e) => e.from.startsWith('packages/cli/src/') && e.to.startsWith('packages/core/src/')).length;
if (harnessCross === 0) {
  failed = true;
  console.error('✖ The harness adapter sees no cli → core imports: it would pass without checking anything.');
}
try {
  const text = execFileSync(process.execPath, [path.join(root, 'packages/cli/src/bin.js'), 'check'], { cwd: root, encoding: 'utf8' });
  console.log(`2. harness check: ${text.trim().split('\n').slice(-2).join(' · ')} (${harnessCross} cli → core imports seen)`);
} catch (e) {
  failed = true;
  console.error(`✖ harness check failed:\n${e.stdout ?? ''}${e.stderr ?? ''}`);
}

console.log(failed ? 'self-check: FAIL' : 'self-check: pass');
process.exitCode = failed ? 1 : 0;
