// Reads one Ruby file with Prism (the parser Ruby itself ships, here as WebAssembly: no Ruby needed) and returns
// the facts the graph is built from: which constants the file defines, which it references and from which lexical
// scope, plus the few method calls that name another file (require_relative, associations, Inertia renders).

/** @typedef {{ name: string, owner: boolean }} Definition  owner: false for a namespace that only wraps other definitions */
/** @typedef {{ path: string, scopes: string[] }} Reference  scopes: enclosing modules, innermost first; empty for `::Absolute` */
/**
 * @typedef {object} FileFacts
 * @property {Definition[]} defs
 * @property {Reference[]} refs
 * @property {{ spec: string, relative: boolean }[]} requires
 * @property {{ macro: string, name: string, className: string | null, scopes: string[] }[]} associations
 * @property {{ component: string | null, action: string | null }[]} renders `render inertia:`; component null = inferred from the action
 * @property {string[]} routes components named by `inertia 'path' => 'Component'` in the routes
 * @property {boolean} syntaxErrors
 */

const ASSOCIATIONS = new Set(['has_many', 'has_one', 'belongs_to', 'has_and_belongs_to_many']);

/** @type {Promise<{ P: any, parse: (source: Uint8Array) => any }> | null} */
let loading = null;

/**
 * Loads Prism once per process. Node prints an ExperimentalWarning for WASI on every run; it is hidden here because
 * the person can do nothing about it.
 */
export function loadParser() {
  loading ??= (async () => {
    const original = process.emitWarning;
    process.emitWarning = /** @type {any} */ ((warning, ...rest) => {
      const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
      if (type === 'ExperimentalWarning' && /WASI/.test(String(warning))) return;
      return original.call(process, warning, ...rest);
    });
    try {
      const P = await import('@ruby/prism');
      return { P, parse: await P.loadPrism() };
    } finally {
      process.emitWarning = original;
    }
  })();
  return loading;
}

/**
 * @param {{ P: any, parse: (source: Uint8Array) => any }} parser from loadParser()
 * @param {Uint8Array} source the file's bytes
 * @returns {FileFacts}
 */
export function readRuby({ P, parse }, source) {
  const result = parse(source);
  /** @type {FileFacts} */
  const facts = { defs: [], refs: [], requires: [], associations: [], renders: [], routes: [], syntaxErrors: result.errors.length > 0 };
  /** @type {string[]} full names of the enclosing modules, outermost first */
  const stack = [];
  /** @type {string | null} name of the enclosing instance method */
  let action = null;
  const seen = new Set();

  const scopes = () => [...stack].reverse();
  const qualify = (p) => (p.absolute || !stack.length ? p.path : `${stack[stack.length - 1]}::${p.path}`);

  /** `A::B` as text, or null when part of it is not a constant (`foo::Bar`). */
  const constPath = (node) => {
    const parts = [];
    while (node instanceof P.ConstantPathNode) {
      if (!node.name) return null;
      parts.unshift(node.name);
      if (!node.parent) return { path: parts.join('::'), absolute: true };
      node = node.parent;
    }
    if (!(node instanceof P.ConstantReadNode)) return null;
    parts.unshift(node.name);
    return { path: parts.join('::'), absolute: false };
  };

  const text = (node) => (node instanceof P.StringNode || node instanceof P.SymbolNode ? node.unescaped.value : null);
  const args = (call) => call.arguments_?.arguments_ ?? [];
  /** Keyword arguments of a call (`key: value` and `'key' => value`). */
  const keywords = (call) => {
    const out = new Map();
    for (const arg of args(call)) {
      if (!(arg instanceof P.KeywordHashNode)) continue;
      for (const el of arg.elements) if (el instanceof P.AssocNode && text(el.key) !== null) out.set(text(el.key), el.value);
    }
    return out;
  };

  /** A module or class whose body is only other modules and classes: a namespace, defined again in every file under it. */
  const isWrapper = (node) => {
    if (node instanceof P.ClassNode && node.superclass) return false;
    const body = node.body instanceof P.StatementsNode ? node.body.body : [];
    return body.length > 0 && body.every((s) => s instanceof P.ClassNode || s instanceof P.ModuleNode);
  };

  const call = (node) => {
    const [first] = args(node);
    if (node.name === 'require_relative' || node.name === 'require') {
      if (first instanceof P.StringNode) facts.requires.push({ spec: first.unescaped.value, relative: node.name === 'require_relative' });
    } else if (ASSOCIATIONS.has(node.name)) {
      const kw = keywords(node);
      if (first instanceof P.SymbolNode && !kw.has('polymorphic')) {
        const className = kw.has('class_name') ? text(kw.get('class_name')) : null;
        // class_name: given as something else than a string (Foo.name): the constant walk below finds it
        if (className !== null || !kw.has('class_name')) {
          facts.associations.push({ macro: node.name, name: first.unescaped.value, className, scopes: scopes() });
        }
      }
    } else if (node.name === 'render') {
      const target = keywords(node).get('inertia');
      if (target instanceof P.StringNode) facts.renders.push({ component: target.unescaped.value, action });
      else if (target instanceof P.HashNode || target instanceof P.TrueNode) facts.renders.push({ component: null, action });
    } else if (node.name === 'inertia') {
      // routes: `inertia 'dashboard' => 'Dashboard'`, or `inertia 'about'` (component named like the path)
      if (first instanceof P.KeywordHashNode) {
        const el = first.elements[0];
        if (el instanceof P.AssocNode && text(el.key) !== null && el.value instanceof P.StringNode) facts.routes.push(el.value.unescaped.value);
      } else if (text(first) !== null) facts.routes.push(text(first));
    }
  };

  const children = (node) => {
    for (const child of node.compactChildNodes()) walk(child);
  };

  const walk = (node) => {
    if (!node) return;
    if (node instanceof P.ClassNode || node instanceof P.ModuleNode) {
      if (node.superclass) walk(node.superclass);
      const p = constPath(node.constantPath);
      if (!p) return walk(node.body);
      const full = qualify(p);
      facts.defs.push({ name: full, owner: !isWrapper(node) });
      stack.push(full);
      walk(node.body);
      stack.pop();
    } else if (node instanceof P.ConstantReadNode || node instanceof P.ConstantPathNode) {
      const p = constPath(node);
      if (!p) return children(node);
      const ref = { path: p.path, scopes: p.absolute ? [] : scopes() };
      const key = `${p.absolute ? '::' : (ref.scopes[0] ?? '')}|${ref.path}`;
      if (!seen.has(key)) {
        seen.add(key);
        facts.refs.push(ref);
      }
    } else if (node instanceof P.ConstantWriteNode) {
      facts.defs.push({ name: qualify({ path: node.name, absolute: false }), owner: true });
      walk(node.value);
    } else if (node instanceof P.ConstantPathWriteNode) {
      const p = constPath(node.target);
      if (p) facts.defs.push({ name: qualify(p), owner: true });
      walk(node.value);
    } else if (node instanceof P.DefNode) {
      const outer = action;
      action = node.receiver ? null : node.name;
      children(node);
      action = outer;
    } else {
      if (node instanceof P.CallNode && !node.receiver) call(node);
      children(node);
    }
  };

  walk(result.value);
  return facts;
}
