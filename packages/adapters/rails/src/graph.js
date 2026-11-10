// Builds the dependency graph of a Rails app. Ruby files don't import each other: Zeitwerk loads a file when its
// constant is first used. So an edge is "file A names a constant that file B defines", plus require_relative,
// associations (`has_many :orders` names Order) and Inertia renders (a controller names a page component).
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { matchesAny } from '@agentreins/core/contract';
import { camelize, readInflections, singulars } from './inflect.js';
import { inferredComponent, readInertia } from './inertia.js';
import { loadPreset } from './presets.js';
import { loadParser, readRuby } from './ruby.js';

/** Folders never scanned. */
export const IGNORED_DIRS = ['node_modules', '.git', '.reins', '.bundle', 'vendor', 'tmp', 'log', 'storage', 'public', 'coverage', 'dist', 'build'];
const RUBY_FILE = /\.(rb|rake)$/;

// Classes of Ruby itself. An app that reopens one (lib/core_ext/string.rb) does not make every file that
// mentions String depend on that file.
const CORE = new Set([
  'Object', 'BasicObject', 'Kernel', 'Module', 'Class', 'Comparable', 'Enumerable', 'String', 'Symbol', 'Integer', 'Float',
  'Numeric', 'Array', 'Hash', 'Range', 'Set', 'Proc', 'Struct', 'Time', 'Date', 'DateTime', 'NilClass', 'TrueClass',
  'FalseClass', 'Exception', 'StandardError', 'File', 'Dir', 'IO', 'Regexp', 'Math',
]);

/** Every Ruby file of the repo, relative, POSIX, sorted. */
function rubyFiles(root, ignored) {
  const out = [];
  const walk = (dir, rel) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.includes(entry.name)) walk(path.join(dir, entry.name), next);
      } else if (RUBY_FILE.test(entry.name) && !ignored(next)) out.push(next);
    }
  };
  walk(root, '');
  return out.sort();
}

/**
 * Finds the files that define the constant a reference names, the way Ruby looks it up: from the innermost
 * enclosing module outwards. `Billing::Invoice::STATUSES` resolves to the file of the longest name that has one
 * (`Billing::Invoice`). Constants inherited from a superclass are not followed.
 * @param {string} refPath
 * @param {string[]} scopes innermost first; empty for an absolute reference
 * @param {Set<string>} known every constant defined in the repo, namespaces included
 * @param {Map<string, Set<string>>} owners constant -> files that define it
 * @returns {Set<string> | null}
 */
export function resolveConstant(refPath, scopes, known, owners) {
  const head = refPath.split('::')[0];
  for (const scope of [...scopes, '']) {
    const prefix = scope ? `${scope}::` : '';
    if (!known.has(prefix + head)) continue;
    const shortest = (prefix + head).length;
    for (let full = prefix + refPath; ; full = full.slice(0, full.lastIndexOf('::'))) {
      const files = owners.get(full);
      if (files) return files;
      if (full.length <= shortest) return null; // a namespace no single file owns
    }
  }
  return null; // not defined in the repo: a gem or Ruby itself
}

const some = (list, max = 5) => list.slice(0, max).join(', ') + (list.length > max ? `, and ${list.length - max} more` : '');

/**
 * @param {string} repoPath
 * @param {{ preset?: string, ignore?: string[] }} [config] the parsed architecture.yml (uses `preset` and `ignore`)
 * @returns {Promise<{ edges: import('@agentreins/core/contract').Edge[], files: string[], entries: string[], warnings: string[] }>}
 */
export async function graph(repoPath, config = {}) {
  const root = realpathSync(path.resolve(repoPath));
  const ignore = config.ignore ?? [];
  const ignored = (f) => ignore.length > 0 && matchesAny(f, ignore);
  const files = rubyFiles(root, ignored);
  const fileSet = new Set(files);
  const warnings = [];

  const parser = await loadParser();
  /** @type {Map<string, import('./ruby.js').FileFacts>} */
  const facts = new Map();
  const broken = [];
  for (const file of files) {
    const f = readRuby(parser, readFileSync(path.join(root, file)));
    facts.set(file, f);
    if (f.syntaxErrors) broken.push(file);
  }
  if (broken.length) {
    warnings.push(`${broken.length} Ruby file(s) have syntax errors, so some of their dependencies may be missing: ${some(broken)}.`);
  }

  // which file defines which constant
  const known = new Set();
  /** @type {Map<string, Set<string>>} */
  const owners = new Map();
  for (const [file, f] of facts) {
    for (const def of f.defs) {
      known.add(def.name);
      if (!def.owner || CORE.has(def.name)) continue;
      if (!owners.has(def.name)) owners.set(def.name, new Set());
      /** @type {Set<string>} */ (owners.get(def.name)).add(file);
    }
  }

  /** @type {Map<string, import('@agentreins/core/contract').Edge>} */
  const edges = new Map();
  const add = (from, to, kind) => {
    if (from === to || ignored(to)) return;
    const key = `${from}\n${to}`;
    // one edge per pair of files; a constant reference wins over the kinds a rule may ignore
    if (!edges.has(key) || kind === 'static') edges.set(key, { from, to, kind });
  };

  const inflections = readInflections(root);
  const inertia = readInertia(root);
  const missingPages = [];
  let inferredSkipped = 0;
  const page = (file, component) => {
    const target = /** @type {import('./inertia.js').InertiaPages} */ (inertia).find(component);
    if (target) add(file, target, 'inertia');
    else missingPages.push(`'${component}' in ${file}`);
  };

  for (const [file, f] of facts) {
    for (const ref of f.refs) {
      for (const to of resolveConstant(ref.path, ref.scopes, known, owners) ?? []) add(file, to, 'static');
    }

    for (const req of f.requires) {
      const base = req.relative ? path.posix.join(path.posix.dirname(file), req.spec) : path.posix.join('lib', req.spec);
      const to = [base, `${base}.rb`].find((candidate) => fileSet.has(candidate));
      if (to) add(file, to, 'static');
    }

    for (const assoc of f.associations) {
      const plural = assoc.macro === 'has_many' || assoc.macro === 'has_and_belongs_to_many';
      const names = assoc.className !== null
        ? [assoc.className.replace(/^::/, '')]
        : (plural ? singulars(assoc.name, inflections) : [assoc.name]).map((n) => camelize(n, inflections));
      // Rails looks an association's class up in every namespace of the model, whatever the lexical nesting:
      // `class Billing::LineItem; belongs_to :invoice` finds Billing::Invoice
      const model = assoc.scopes[0] ?? '';
      const scopes = assoc.className?.startsWith('::') ? [] : model.split('::').map((_, i, parts) => parts.slice(0, parts.length - i).join('::')).filter(Boolean);
      for (const name of names) {
        const targets = resolveConstant(name, scopes, known, owners);
        if (!targets) continue;
        for (const to of targets) add(file, to, 'association');
        break;
      }
    }

    if (!inertia) continue;
    for (const render of f.renders) {
      if (render.component !== null) page(file, render.component);
      else if (inertia.customResolver) inferredSkipped++;
      else {
        const component = render.action && inferredComponent(file, render.action);
        if (component) page(file, component);
      }
    }
    // `inertia 'path' => 'Component'` only means a page inside the routes
    if (/^config\/routes(\.rb$|\/)/.test(file)) for (const component of f.routes) page(file, component);
  }

  if (inertia && !inertia.roots.length && [...facts.values()].some((f) => f.renders.length || f.routes.length)) {
    warnings.push('This app renders Inertia pages, but no pages folder was found (looked for app/frontend/pages and app/javascript/pages): controller -> page dependencies are not checked.');
  } else if (missingPages.length) {
    warnings.push(`${missingPages.length} Inertia page(s) rendered from Ruby were not found under ${inertia?.roots.join(', ')}, so they are not checked: ${some(missingPages)}.`);
  }
  if (inferredSkipped) {
    warnings.push(`This app sets component_path_resolver, so ${inferredSkipped} \`render inertia:\` call(s) without a component name are not followed. Name the component to have them checked.`);
  }

  const entryGlobs = loadPreset(config.preset ?? 'rails').entries;
  const entries = files.filter((f) => matchesAny(f, entryGlobs));
  return { edges: [...edges.values()], files, entries, warnings };
}
