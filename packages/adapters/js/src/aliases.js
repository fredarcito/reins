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
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      let close = index + 1;
      while (close < text.length && text[close] !== '"') close += text[close] === '\\' ? 2 : 1;
      out += text.slice(index, close + 1);
      index = close + 1;
    } else if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index++;
    } else if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      out += char;
      index++;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** @param {string} filePath */
const toPosix = (filePath) => filePath.split(path.sep).join('/');

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
  } catch (error) {
    warnings.push(`${path.basename(file)}: could not be parsed (${error.message}); its aliases are ignored.`);
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
  const options = json.compilerOptions ?? {};
  if (options.baseUrl !== undefined) merged.baseUrl = path.resolve(dir, options.baseUrl);
  if (options.paths !== undefined) {
    merged.paths = options.paths;
    merged.pathsBase = dir;
  }
  for (const reference of json.references ?? []) {
    if (!reference || typeof reference.path !== 'string') continue;
    let target = path.resolve(dir, reference.path);
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
      add(alias, `${key}$`, targets.map((target) => path.resolve(base, target)));
    } else if (key.endsWith('/*') && star === key.length - 1) {
      const dirs = targets.filter((target) => target.endsWith('/*')).map((target) => path.resolve(base, target.slice(0, -2)));
      if (dirs.length) add(alias, key.slice(0, -2), dirs);
      else warnings.push(`${source}: paths "${key}" maps to targets without "/*"; not supported, ignored.`);
    } else {
      warnings.push(`${source}: paths pattern "${key}" is not supported (only "prefix/*" and exact keys); ignored.`);
    }
  }
}

function add(alias, name, targets) {
  const list = (alias[name] ??= []);
  for (const target of targets) if (!list.includes(target)) list.push(target);
}

/** Finds the matching closing bracket for text[open]. String-aware. */
function closing(text, open) {
  const pairs = { '{': '}', '[': ']', '(': ')' };
  const stack = [pairs[text[open]]];
  for (let index = open + 1; index < text.length; index++) {
    const char = text[index];
    if (char === '"' || char === "'" || char === '`') {
      let close = index + 1;
      while (close < text.length && text[close] !== char) close += text[close] === '\\' ? 2 : 1;
      index = close;
    } else if (pairs[char]) stack.push(pairs[char]);
    else if (char === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return index;
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
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (quote) {
      if (char === '\\') index++;
      else if (char === quote) quote = null;
    } else if (char === '"' || char === "'" || char === '`') quote = char;
    else if ('{[('.includes(char)) depth++;
    else if ('}])'.includes(char)) depth--;
    else if (char === ',' && depth === 0) {
      parts.push(body.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The last string literal of an expression that looks like a path: `path.resolve(__dirname, './src')` -> './src'. */
function pathLiteral(expr) {
  const strings = [...expr.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((match) => match[2]);
  return strings.reverse().find((candidate) => candidate.startsWith('.') || candidate.startsWith('/') || /^[\w@-]+(\/|$)/.test(candidate));
}

/**
 * Reads `resolve.alias` from vite.config.* without executing it. Supports the object form
 * (`{ '@': path.resolve(__dirname, './src') }`) and the array form (`[{ find: '@', replacement: … }]`).
 */
function viteAliases(repoPath, alias, warnings, sources) {
  const file = VITE_CONFIGS.find((configFile) => existsSync(path.join(repoPath, configFile)));
  if (!file) return;
  const text = readFileSync(path.join(repoPath, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const match = /\balias\s*:\s*/.exec(text);
  if (!match) return;
  const open = match.index + match[0].length;
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
      const keyMatch = /^(?:(['"`])((?:\\.|(?!\1).)*)\1|([\w$@~#-]+))\s*:\s*([\s\S]*)$/.exec(entry);
      if (!keyMatch) continue;
      key = keyMatch[2] ?? keyMatch[3];
      value = keyMatch[4];
    } else {
      const findMatch = /\bfind\s*:\s*(['"`])((?:\\.|(?!\1).)*)\1/.exec(entry);
      const replacement = /\breplacement\s*:\s*([\s\S]*)$/.exec(entry);
      if (!findMatch) {
        warnings.push(`${file}: an alias uses a regular expression in "find"; set it in jsconfig.json/tsconfig.json "paths" instead.`);
        continue;
      }
      key = findMatch[2];
      value = replacement?.[1] ?? '';
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
  const queue = ['tsconfig.json', 'jsconfig.json'].map((name) => path.join(repoPath, name));
  const visited = new Set();
  while (queue.length) {
    const file = queue.shift();
    if (visited.has(file)) continue;
    visited.add(file);
    const config = loadTsconfig(file, info.warnings);
    if (!config) continue;
    const relativeFile = toPosix(path.relative(repoPath, file));
    if (config.paths) {
      pathsToAlias(config.paths, config.baseUrl ?? config.pathsBase, info.alias, info.warnings, relativeFile);
      info.sources.push(relativeFile);
    }
    if (config.baseUrl && !info.modules.includes(config.baseUrl)) {
      info.modules.push(config.baseUrl);
      if (!info.sources.includes(relativeFile)) info.sources.push(relativeFile);
    }
    queue.push(...config.references);
  }
  viteAliases(repoPath, info.alias, info.warnings, info.sources);
  return info;
}
