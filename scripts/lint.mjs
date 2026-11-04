#!/usr/bin/env node
// Simple repo linter, no dependencies. Checks:
//   syntax          every .js/.mjs file under packages/ and scripts/ parses (node --check)
//   import-boundary core never imports cli/adapters; adapter code (not its tests) only imports core through "<scope>/core/contract"
//   agents-md       AGENTS.md has at most 30 lines; AGENTS.md/CLAUDE.md only at the root, templates/ or examples/<name>/
//   diagrams        mermaid blocks in markdown without HTML entities, quotes/<>/| in labels or reserved node ids
//   packages        every workspace package is ESM and uses the same npm scope; adapters declare core as peer + reins.contract
// The real architecture check of this repo (phase 9) will replace import-boundary.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage']);
export const AGENTS_MAX_LINES = 30;

/** @param {string} dir @returns {string[]} absolute file paths */
function walk(dir) {
  if (!existsSync(dir)) return [];
  const files = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

/** @param {string} source @returns {string[]} module specifiers imported by the source */
export function importSpecifiers(source) {
  const specs = [];
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(re)) specs.push(m[1] ?? m[2] ?? m[3]);
  return specs;
}

/**
 * @param {string} root repo root
 * @returns {{ rule: string, file: string, message: string }[]}
 */
export function lint(root) {
  /** @type {{ rule: string, file: string, message: string }[]} */
  const problems = [];
  const rel = (f) => path.relative(root, f);
  const report = (rule, file, message) => problems.push({ rule, file: rel(file), message });

  // packages
  const pkgDirs = [
    ...['core', 'cli'].map((n) => path.join(root, 'packages', n)),
    ...(existsSync(path.join(root, 'packages/adapters'))
      ? readdirSync(path.join(root, 'packages/adapters')).map((n) => path.join(root, 'packages/adapters', n))
      : []),
  ].filter((d) => existsSync(path.join(d, 'package.json')));
  const pkgs = pkgDirs.map((dir) => ({ dir, json: JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) }));
  const core = pkgs.find((p) => p.dir.endsWith(path.join('packages', 'core')));
  const scope = core?.json.name.split('/')[0];
  const cliName = pkgs.find((p) => p.dir.endsWith(path.join('packages', 'cli')))?.json.name ?? `${scope}/cli`;
  const isCliImport = (s) => s === cliName || s.startsWith(`${cliName}/`);
  if (!scope?.startsWith('@')) report('packages', path.join(root, 'packages/core/package.json'), 'core package name must be scoped (@scope/core)');
  for (const p of pkgs) {
    const file = path.join(p.dir, 'package.json');
    if (scope && !p.json.name.startsWith(`${scope}/`)) report('packages', file, `name "${p.json.name}" does not use scope ${scope}`);
    if (p.dir.endsWith(path.join('packages', 'cli'))) {
      // one command, always "reins": docs, templates, hooks and CI call it by that name
      const bins = Object.keys(p.json.bin ?? {});
      if (bins.length !== 1 || bins[0] !== 'reins') report('packages', file, `the CLI must have exactly one bin, "reins" (found: ${bins.join(', ') || 'none'})`);
    }
    // Also required for the syntax check: without it, `node --check` accepts broken ESM in .js files (Node 22).
    if (p.json.type !== 'module') report('packages', file, 'package must declare "type": "module"');
    if (p.dir.includes(path.join('packages', 'adapters'))) {
      if (!p.json.peerDependencies?.[`${scope}/core`]) report('packages', file, `adapter must declare ${scope}/core as a peerDependency`);
      if (p.json.dependencies?.[`${scope}/core`]) report('packages', file, `adapter must not list ${scope}/core in dependencies`);
      if (!Number.isInteger(p.json.reins?.contract)) report('packages', file, 'adapter must declare "reins": { "contract": <n> }');
    }
  }

  // syntax + import-boundary
  const jsFiles = [...walk(path.join(root, 'packages')), ...walk(path.join(root, 'scripts'))].filter((f) => /\.m?js$/.test(f));
  for (const file of jsFiles) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (e) {
      report('syntax', file, String(e.stderr).trim().split('\n').slice(0, 5).join(' | '));
      continue;
    }
    if (!scope) continue;
    const r = rel(file).split(path.sep).join('/');
    const specs = importSpecifiers(readFileSync(file, 'utf8'));
    if (r.startsWith('packages/core/')) {
      for (const s of specs) {
        if (isCliImport(s) || s.startsWith(`${scope}/adapter-`) || /(^|\/)(cli|adapters)\//.test(s) && s.startsWith('.')) {
          report('import-boundary', file, `core must not import from cli or adapters ("${s}")`);
        }
      }
    }
    if (r.startsWith('packages/adapters/') && !r.split('/').includes('test')) {
      for (const s of specs) {
        if (isCliImport(s)) report('import-boundary', file, `adapters must not import the cli ("${s}")`);
        if (s.startsWith(`${scope}/core`) && s !== `${scope}/core/contract`) {
          report('import-boundary', file, `adapters may only import ${scope}/core/contract ("${s}")`);
        }
      }
    }
  }

  // agents-md
  for (const file of walk(root)) {
    const name = path.basename(file);
    if (name !== 'AGENTS.md' && name !== 'CLAUDE.md') continue;
    const dir = rel(path.dirname(file)).split(path.sep).join('/');
    const allowed = dir === '' || dir === 'templates' || dir.startsWith('templates/') || /^examples\/[^/]+$/.test(dir);
    if (!allowed) report('agents-md', file, `${name} is only allowed at the repo root, templates/ or examples/<name>/ (no per-folder files)`);
    if (name === 'AGENTS.md') {
      const lines = readFileSync(file, 'utf8').trimEnd().split('\n').length;
      if (lines > AGENTS_MAX_LINES) report('agents-md', file, `${lines} lines; the limit is ${AGENTS_MAX_LINES}`);
    }
  }

  // diagrams: mermaid blocks in markdown that GitHub fails to render
  for (const file of walk(root).filter((f) => f.endsWith('.md'))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/```mermaid\n([\s\S]*?)```/g)) {
      const line = text.slice(0, m.index).split('\n').length;
      m[1].split('\n').forEach((l, i) => {
        const at = `line ${line + 1 + i}`;
        if (/&(quot|lt|gt|amp|#\d+);/.test(l)) report('diagrams', file, `${at}: HTML entity in a mermaid diagram (GitHub decodes it and the diagram breaks); reword the label`);
        for (const label of l.matchAll(/\["([^\]]*)"\]|\{"([^}]*)"\}|\("([^)]*)"\)/g)) {
          const t = label[1] ?? label[2] ?? label[3];
          if (/["<>|]/.test(t.replace(/<br\/>/g, ''))) report('diagrams', file, `${at}: label contains " < > or | ("${t}"); reword it`);
        }
        if (/^\s*(graph|end|subgraph|flowchart|style|class|click)\s*[[({]/.test(l)) report('diagrams', file, `${at}: reserved word used as a node id; rename the node`);
      });
    }
  }

  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  const problems = lint(root);
  for (const p of problems) console.error(`${p.rule}  ${p.file}  ${p.message}`);
  console.log(problems.length ? `lint: ${problems.length} problem(s)` : 'lint: ok');
  process.exitCode = problems.length ? 1 : 0;
}
