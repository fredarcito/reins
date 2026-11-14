// Builds the dependency graph of a Rust repo. A crate is a tree of modules: `mod x;` in a file puts x.rs (or
// x/mod.rs) under it. An edge is "file A names a module of file B": `use crate::config::Lang`, `super::search::words`,
// `chat::store::load()`, `lingora_lib::run()` from a bin of the same package. A path ends at the deepest module it
// names, so `crate::config::Lang` depends on the file of `config`; items are never indexed.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from '@agentreins/core/contract';
import { readPackage } from './cargo.js';
import { loadPreset } from './presets.js';
import { readRust } from './rust.js';

/** Folders never scanned. */
export const IGNORED_DIRS = ['node_modules', '.git', '.reins', 'target', 'vendor', 'dist', 'build', 'coverage'];

/**
 * @typedef {object} Module
 * @property {string} file  file that holds it (an inline `mod x { }` lives in its parent's file)
 * @property {string} dir   folder where its `mod y;` children are looked for
 * @property {Module | null} parent
 * @property {Map<string, Module>} children
 * @property {Map<string, Module>} aliases  modules a `use` brought into scope
 * @property {Set<Module>} globs  modules imported with `use x::*`
 * @property {import('./rust.js').Scope} scope
 * @property {Crate} crate
 * @typedef {{ name: string, root: Module | null, edition: string }} Crate
 */

/** Every `.rs` file and every folder with a Cargo.toml, relative, POSIX, sorted. */
function walk(repoRoot, isIgnored) {
  const files = [];
  const manifestDirs = [];
  const visit = (absoluteDir, relativeDir) => {
    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      const relative = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.includes(entry.name) && !entry.name.startsWith('.')) visit(path.join(absoluteDir, entry.name), relative);
      } else if (entry.name === 'Cargo.toml') manifestDirs.push(relativeDir);
      else if (entry.name.endsWith('.rs') && !isIgnored(relative)) files.push(relative);
    }
  };
  visit(repoRoot, '');
  return { files: files.sort(), manifestDirs: manifestDirs.sort() };
}

const some = (list, max = 5) => list.slice(0, max).join(', ') + (list.length > max ? `, and ${list.length - max} more` : '');

/** @returns {Module} */
const newModule = ({ file, dir, parent, scope, crate }) => ({ file, dir, parent, children: new Map(), aliases: new Map(), globs: new Set(), scope, crate });

/**
 * @param {string} repoPath
 * @param {{ preset?: string, ignore?: string[] }} [config] the parsed architecture.yml (uses `preset` and `ignore`)
 * @returns {Promise<{ edges: import('@agentreins/core/contract').Edge[], files: string[], entries: string[], warnings: string[] }>}
 */
export async function graph(repoPath, config = {}) {
  const repoRoot = realpathSync(path.resolve(repoPath));
  const ignore = config.ignore ?? [];
  const isIgnored = (file) => ignore.length > 0 && matchesAny(file, ignore);
  const { files, manifestDirs } = walk(repoRoot, isIgnored);
  const fileSet = new Set(files);
  const warnings = [];

  /** @type {Map<string, import('./rust.js').Scope>} */
  const parsed = new Map();
  const scopeOf = (file) => {
    if (!parsed.has(file)) parsed.set(file, readRust(readFileSync(path.join(repoRoot, file), 'utf8')));
    return /** @type {import('./rust.js').Scope} */ (parsed.get(file));
  };

  /** @type {Map<string, import('@agentreins/core/contract').Edge>} */
  const edges = new Map();
  const addEdge = (from, to, kind) => {
    if (from === to || isIgnored(to)) return;
    const key = `${from}\n${to}`;
    // one edge per pair of files; a real use wins over the declaration a rule may ignore
    if (!edges.has(key) || kind === 'static') edges.set(key, { from, to, kind });
  };

  // 1. crates and their module trees
  const packages = manifestDirs.map((dir) => readPackage(repoRoot, dir)).filter((pkg) => pkg !== null);
  /** @type {Module[]} */
  const modules = [];
  /** @type {Map<string, Module>} the first module found in each file */
  const moduleOfFile = new Map();
  const missingMods = [];
  /** @type {Map<string, Crate>} library crates by name, for `other_crate::x` */
  const libraries = new Map();
  /** @type {Crate[]} */
  const crates = [];
  const entries = new Set();

  /** The module a `mod name;` declaration loads from its own file, or null when there is no such file. */
  const fileModule = (parentModule, decl) => {
    // #[path] is relative to the folder of the file that declares it
    const candidates = decl.path
      ? [path.posix.normalize(`${path.posix.dirname(parentModule.file)}/${decl.path}`)]
      : [`${parentModule.dir}/${decl.name}.rs`, `${parentModule.dir}/${decl.name}/mod.rs`];
    const file = candidates.find((candidate) => fileSet.has(candidate));
    if (!file) {
      // an ignored file exists: not a missing module
      if (!candidates.some((candidate) => existsSync(path.join(repoRoot, candidate)))) missingMods.push(`\`mod ${decl.name}\` in ${parentModule.file}`);
      return null;
    }
    addEdge(parentModule.file, file, 'mod');
    // a file included twice (#[path]) keeps its first module, which also stops loops
    const existing = moduleOfFile.get(file);
    if (existing) return { module: existing, isNew: false };
    // x/mod.rs and #[path] files hold their children next to them; x.rs holds them in x/
    const childrenNextToFile = Boolean(decl.path) || path.posix.basename(file) === 'mod.rs';
    const dir = childrenNextToFile ? path.posix.dirname(file) : file.slice(0, -'.rs'.length);
    return { module: newModule({ file, dir, parent: parentModule, scope: scopeOf(file), crate: parentModule.crate }), isNew: true };
  };

  /** @param {Module} module */
  const buildTree = (module) => {
    modules.push(module);
    if (!moduleOfFile.has(module.file)) moduleOfFile.set(module.file, module);
    for (const decl of module.scope.mods) {
      const child = decl.scope
        ? { module: newModule({ file: module.file, dir: `${module.dir}/${decl.name}`, parent: module, scope: decl.scope, crate: module.crate }), isNew: true }
        : fileModule(module, decl);
      if (!child) continue;
      module.children.set(decl.name, child.module);
      if (child.isNew) buildTree(child.module);
    }
  };

  for (const pkg of packages) {
    for (const crateRoot of pkg.crates) {
      if (isIgnored(crateRoot.root) || !fileSet.has(crateRoot.root)) continue;
      entries.add(crateRoot.root);
      /** @type {Crate} */
      const crate = { name: crateRoot.name, root: null, edition: pkg.edition };
      crate.root = newModule({ file: crateRoot.root, dir: path.posix.dirname(crateRoot.root), parent: null, scope: scopeOf(crateRoot.root), crate });
      crates.push(crate);
      if (crateRoot.kind === 'lib') libraries.set(crateRoot.name, crate);
    }
  }
  for (const crate of crates) buildTree(/** @type {Module} */ (crate.root));

  if (files.length && !packages.length) {
    warnings.push('Found Rust files but no Cargo.toml with a [package] table, so no module tree could be built and Rust dependencies are not checked.');
  }
  if (missingMods.length) {
    warnings.push(`${missingMods.length} Rust module declaration(s) point to no file, so the dependencies inside them are not checked: ${some(missingMods)}. A module generated at build time can be ignored.`);
  }

  // 2. where a path starts, inside a module
  /** @type {Record<string, (module: Module) => Module | null>} */
  const keywordStart = {
    crate: (module) => module.crate.root,
    self: (module) => module,
    super: (module) => module.parent,
  };
  /**
   * @param {Module} module
   * @param {string} first
   * @param {boolean} isUse
   * @returns {Module | null}
   */
  const startOf = (module, first, isUse) => {
    if (Object.hasOwn(keywordStart, first)) return keywordStart[first](module);
    const local = module.children.get(first) ?? module.aliases.get(first);
    if (local) return local;
    for (const globModule of module.globs) {
      const found = globModule.children.get(first);
      if (found) return found;
    }
    const library = libraries.get(first);
    if (library) return library.root;
    // Rust 2015: `use` paths start at the crate root
    if (isUse && module.crate.edition === '2015') return module.crate.root?.children.get(first) ?? null;
    return null;
  };
  /** @type {Record<string, (module: Module) => Module | null>} */
  const keywordStep = {
    super: (module) => module.parent,
    self: (module) => module,
  };
  /**
   * The deepest module a path names, and whether the whole path is that module.
   * @param {Module} module
   * @param {string[]} segments
   * @param {boolean} isUse
   */
  const resolve = (module, segments, isUse) => {
    if (segments[0] === '::') return null; // `::crate_name::…`: external
    let reached = startOf(module, segments[0], isUse);
    if (!reached) return null;
    let consumed = 1;
    for (; consumed < segments.length; consumed++) {
      const segment = segments[consumed];
      const next = Object.hasOwn(keywordStep, segment)
        ? keywordStep[segment](reached)
        : reached.children.get(segment) ?? reached.aliases.get(segment);
      if (!next) break;
      reached = next;
    }
    return { module: reached, complete: consumed === segments.length };
  };

  // 3. what each `use` brings into scope; repeated because a use may build on another (`use crate::chat; use chat::store;`)
  const bringIntoScope = (module, useEntry) => {
    const resolved = resolve(module, useEntry.segments, true);
    if (!resolved?.complete) return false;
    if (useEntry.glob) {
      if (module.globs.has(resolved.module)) return false;
      module.globs.add(resolved.module);
      return true;
    }
    const { alias } = useEntry;
    if (!alias || module.children.has(alias) || module.aliases.get(alias) === resolved.module) return false;
    module.aliases.set(alias, resolved.module);
    return true;
  };
  const MAX_PASSES = 5;
  for (let pass = 0, changed = true; changed && pass < MAX_PASSES; pass++) {
    changed = false;
    for (const module of modules) {
      for (const useEntry of module.scope.uses) changed = bringIntoScope(module, useEntry) || changed;
    }
  }

  // 4. edges
  for (const module of modules) {
    for (const useEntry of module.scope.uses) {
      const resolved = resolve(module, useEntry.segments, true);
      if (resolved) addEdge(module.file, resolved.module.file, 'static');
    }
    for (const segments of module.scope.refs) {
      const resolved = resolve(module, segments, false);
      if (resolved) addEdge(module.file, resolved.module.file, 'static');
    }
  }

  const entryGlobs = loadPreset(config.preset ?? 'cargo').entries;
  for (const file of files) if (matchesAny(file, entryGlobs)) entries.add(file);
  return { edges: [...edges.values()], files, entries: [...entries].sort(), warnings };
}
