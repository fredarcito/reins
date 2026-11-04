// Reads import aliases (`@/…`) so dependency-cruiser can resolve them. Aliases are the most likely source
// of bugs: an unresolved alias silently drops edges, and check would pass without looking.
//
// Sources, merged:
//   1. jsconfig.json / tsconfig.json `compilerOptions.paths` and `baseUrl`, following `extends` (relative files)
//      and `references` (Vite TS templates keep paths in tsconfig.app.json).
//   2. `resolve.alias` in vite.config.*, read statically (the file is never executed).
// Plain JS/JSX projects need no TypeScript installed: everything is parsed here.
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { VITE_CONFIGS } from './detect.js';

/**
 * @typedef {object} AliasInfo
 * @property {Record<string, string[]>} alias  enhanced-resolve aliases: name (or "name$" for exact) -> absolute targets
 * @property {string[]} modules  extra absolute folders to resolve bare imports from (tsconfig baseUrl)
 * @property {string[]} sources  repo-relative files the aliases came from
 * @property {string[]} warnings
 */

/**
 * Parses JSON with comments and trailing commas (tsconfig/jsconfig style). String-aware, so "@/*" survives.
 * @param {string} text
 */
export function parseJsonc(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** @param {string} p */
const toPosix = (p) => p.split(path.sep).join('/');

/**
 * Loads a tsconfig-like file following `extends`, returning merged compilerOptions with
 * the folder each relevant option is relative to.
 * @returns {{ paths?: Record<string, string[]>, pathsBase?: string, baseUrl?: string, references: string[], chain: string[] } | null}
 */
function loadTsconfig(file, warnings, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return null;
  seen.add(file);
  let json;
  try {
    json = parseJsonc(readFileSync(file, 'utf8'));
  } catch (e) {
    warnings.push(`${path.basename(file)}: could not be parsed (${e.message}); its aliases are ignored.`);
    return null;
  }
  const dir = path.dirname(file);
  /** @type {any} */
  let merged = { references: [], chain: [file] };
  const parents = json.extends === undefined ? [] : [].concat(json.extends);
  for (const ext of parents) {
    if (typeof ext !== 'string' || !(ext.startsWith('.') || ext.startsWith('/'))) continue; // package configs carry no project aliases
    let target = path.resolve(dir, ext);
    if (!target.endsWith('.json') && !existsSync(target)) target += '.json';
    const parent = loadTsconfig(target, warnings, seen);
    if (parent) merged = { ...merged, ...parent, references: merged.references, chain: [...merged.chain, ...parent.chain] };
  }
  const co = json.compilerOptions ?? {};
  if (co.baseUrl !== undefined) merged.baseUrl = path.resolve(dir, co.baseUrl);
  if (co.paths !== undefined) {
    merged.paths = co.paths;
    merged.pathsBase = dir;
  }
  for (const ref of json.references ?? []) {
    if (!ref || typeof ref.path !== 'string') continue;
    let target = path.resolve(dir, ref.path);
    if (existsSync(target) && statSync(target).isDirectory()) target = path.join(target, 'tsconfig.json');
    merged.references.push(target);
  }
  return merged;
}

/**
 * Converts tsconfig `paths` into enhanced-resolve aliases.
 * "@/*": ["./src/*"] -> "@": [<repo>/src];  "@lib": ["src/lib/index.ts"] -> "@lib$": [<file>]
 */
function pathsToAlias(paths, base, alias, warnings, source) {
  for (const [key, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets)) continue;
    const star = key.indexOf('*');
    if (star === -1) {
      add(alias, `${key}$`, targets.map((t) => path.resolve(base, t)));
    } else if (key.endsWith('/*') && star === key.length - 1) {
      const dirs = targets.filter((t) => t.endsWith('/*')).map((t) => path.resolve(base, t.slice(0, -2)));
      if (dirs.length) add(alias, key.slice(0, -2), dirs);
      else warnings.push(`${source}: paths "${key}" maps to targets without "/*"; not supported, ignored.`);
    } else {
      warnings.push(`${source}: paths pattern "${key}" is not supported (only "prefix/*" and exact keys); ignored.`);
    }
  }
}

function add(alias, name, targets) {
  const list = (alias[name] ??= []);
  for (const t of targets) if (!list.includes(t)) list.push(t);
}

/** Finds the matching closing bracket for text[open]. String-aware. */
function closing(text, open) {
  const pairs = { '{': '}', '[': ']', '(': ')' };
  const stack = [pairs[text[open]]];
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === '\\' ? 2 : 1;
      i = j;
    } else if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return i;
    }
  }
  return -1;
}

/** Splits a JS object/array body at top-level commas. */
function splitTop(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if ('{[('.includes(c)) depth++;
    else if ('}])'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** The last string literal of an expression that looks like a path: `path.resolve(__dirname, './src')` -> './src'. */
function pathLiteral(expr) {
  const strings = [...expr.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
  return strings.reverse().find((s) => s.startsWith('.') || s.startsWith('/') || /^[\w@-]+(\/|$)/.test(s));
}

/**
 * Reads `resolve.alias` from vite.config.* without executing it. Supports the object form
 * (`{ '@': path.resolve(__dirname, './src') }`) and the array form (`[{ find: '@', replacement: … }]`).
 */
function viteAliases(repoPath, alias, warnings, sources) {
  const file = VITE_CONFIGS.find((f) => existsSync(path.join(repoPath, f)));
  if (!file) return;
  const text = readFileSync(path.join(repoPath, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const m = /\balias\s*:\s*/.exec(text);
  if (!m) return;
  const open = m.index + m[0].length;
  if (text[open] !== '{' && text[open] !== '[') {
    warnings.push(`${file}: resolve.alias is not a literal object or array; set the same aliases in jsconfig.json/tsconfig.json "paths" so reins can read them.`);
    return;
  }
  const end = closing(text, open);
  if (end === -1) return;
  const toTarget = (raw) => {
    if (raw === undefined) return undefined;
    // "/src" in Vite means "<root>/src"
    return raw.startsWith('/') ? path.join(repoPath, raw) : path.resolve(repoPath, raw);
  };
  let found = 0;
  for (const entry of splitTop(text.slice(open + 1, end))) {
    let key;
    let value;
    if (text[open] === '{') {
      const km = /^(?:(['"`])((?:\\.|(?!\1).)*)\1|([\w$@~#-]+))\s*:\s*([\s\S]*)$/.exec(entry);
      if (!km) continue;
      key = km[2] ?? km[3];
      value = km[4];
    } else {
      const find = /\bfind\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(entry);
      const repl = /\breplacement\s*:\s*([\s\S]*)$/.exec(entry);
      if (!find) {
        warnings.push(`${file}: an alias uses a regular expression in "find"; set it in jsconfig.json/tsconfig.json "paths" instead.`);
        continue;
      }
      key = find[2];
      value = repl?.[1] ?? '';
    }
    const target = toTarget(pathLiteral(value));
    if (!key || !target) {
      warnings.push(`${file}: could not read the target of alias "${key}"; set it in jsconfig.json/tsconfig.json "paths" instead.`);
      continue;
    }
    add(alias, key.replace(/\/$/, ''), [target]);
    found++;
  }
  if (found) sources.push(file);
}

/**
 * @param {string} repoPath absolute path
 * @returns {AliasInfo}
 */
export function readAliases(repoPath) {
  /** @type {AliasInfo} */
  const info = { alias: {}, modules: [], sources: [], warnings: [] };
  const queue = ['tsconfig.json', 'jsconfig.json'].map((f) => path.join(repoPath, f));
  const visited = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const cfg = loadTsconfig(file, info.warnings);
    if (!cfg) continue;
    const rel = toPosix(path.relative(repoPath, file));
    if (cfg.paths) {
      pathsToAlias(cfg.paths, cfg.baseUrl ?? cfg.pathsBase, info.alias, info.warnings, rel);
      info.sources.push(rel);
    }
    if (cfg.baseUrl && !info.modules.includes(cfg.baseUrl)) {
      info.modules.push(cfg.baseUrl);
      if (!info.sources.includes(rel)) info.sources.push(rel);
    }
    queue.push(...cfg.references);
  }
  viteAliases(repoPath, info.alias, info.warnings, info.sources);
  return info;
}
