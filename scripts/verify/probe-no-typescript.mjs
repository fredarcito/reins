// Usage: node probe-no-typescript.mjs <toolsDirWithoutTypescript> <fixturesDir>
// Checks that a JS/JSX project resolves @/ aliases with dependency-cruiser when typescript is NOT installed.
import path from 'node:path'; import { pathToFileURL } from 'node:url';
const [tools, fx] = process.argv.slice(2);
const { cruise } = await import(pathToFileURL(path.join(tools, 'node_modules/dependency-cruiser/src/main/index.mjs')).href);
const vite = path.join(fx, 'vite'); process.chdir(vite);
for (const [label, ro] of [['no alias', {}], ['alias as resolve option', { alias: { '@': path.join(vite, 'src') } }]]) {
  const out = JSON.parse((await cruise(['src'], { outputType: 'json' }, ro)).output);
  console.log(`[${label}]`, out.modules.map(m => `${m.source} (${m.dependencies.length} deps)`).join(', '));
  out.modules.flatMap(m => m.dependencies).forEach(d => console.log('   ', d.module, '=>', d.resolved, d.couldNotResolve ? 'UNRESOLVED' : ''));
}
