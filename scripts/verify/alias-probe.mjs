// Usage: node alias-probe.mjs <toolsDir> <fixturesDir>
// Runs dependency-cruiser with several configs and reports whether '@/...' resolved.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [toolsDir, fx] = process.argv.slice(2);
const dc = path.join(toolsDir, 'node_modules/dependency-cruiser');
const { cruise } = await import(pathToFileURL(path.join(dc, 'src/main/index.mjs')).href);
const extractTS = (await import(pathToFileURL(path.join(dc, 'src/config-utl/extract-ts-config.mjs')).href)).default;

async function probe(label, cwd, entry, opts = {}, resolveOptions = {}) {
  const prev = process.cwd();
  process.chdir(cwd);
  try {
    const r = await cruise([entry], { outputType: 'json', ...opts }, resolveOptions, opts.__tsconf ? { tsConfig: opts.__tsconf } : undefined);
    const out = JSON.parse(r.output);
    const deps = out.modules.flatMap((m) => m.dependencies.filter((d) => d.module.startsWith('@/')).map((d) => `${m.source} -> ${d.module} => ${d.resolved}${d.couldNotResolve ? ' (UNRESOLVED)' : ''}`));
    const ok = deps.length > 0 && deps.every((d) => !d.includes('UNRESOLVED'));
    console.log(`\n[${ok ? 'PASS' : 'FAIL'}] ${label}`);
    deps.forEach((d) => console.log('   ', d));
  } catch (e) {
    console.log(`\n[ERROR] ${label}: ${e.message.split('\n')[0]}`);
  } finally {
    process.chdir(prev);
  }
}

const vite = path.join(fx, 'vite');
const next = path.join(fx, 'next');

await probe('Vite without alias config', vite, 'src');
const jsconf = extractTS(path.join(vite, 'jsconfig.json'));
await probe('Vite with jsconfig.json paths (tsConfig)', vite, 'src', { tsConfig: { fileName: 'jsconfig.json' }, __tsconf: jsconf });
await probe('Vite with alias passed as resolve option (what the adapter would read from vite.config)', vite, 'src', {}, { alias: { '@': path.join(vite, 'src') } });
await probe('Next without alias config', next, 'src');
const tsconf = extractTS(path.join(next, 'tsconfig.json'));
await probe('Next with tsconfig.json paths (tsConfig)', next, 'src', { tsConfig: { fileName: 'tsconfig.json' }, __tsconf: tsconf });
