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

/** @type {Promise<{ prism: any, parse: (source: Uint8Array) => any }> | null} */
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
      const prism = await import('@ruby/prism');
      return { prism, parse: await prism.loadPrism() };
    } finally {
      process.emitWarning = original;
    }
  })();
  return loading;
}

/**
 * @param {{ prism: any, parse: (source: Uint8Array) => any }} parser from loadParser()
 * @param {Uint8Array} source the file's bytes
 * @returns {FileFacts}
 */
export function readRuby({ prism, parse }, source) {
  const result = parse(source);
  /** @type {FileFacts} */
  const facts = { defs: [], refs: [], requires: [], associations: [], renders: [], routes: [], syntaxErrors: result.errors.length > 0 };
  /** @type {string[]} full names of the enclosing modules, outermost first */
  const stack = [];
  /** @type {string | null} name of the enclosing instance method */
  let action = null;
  const seen = new Set();

  const scopes = () => [...stack].reverse();
  const qualify = (constant) => (constant.absolute || !stack.length ? constant.path : `${stack[stack.length - 1]}::${constant.path}`);

  /** `A::B` as text, or null when part of it is not a constant (`foo::Bar`). */
  const constPath = (node) => {
    const parts = [];
    let current = node;
    while (current instanceof prism.ConstantPathNode) {
      if (!current.name) return null;
      parts.unshift(current.name);
      if (!current.parent) return { path: parts.join('::'), absolute: true };
      current = current.parent;
    }
    if (!(current instanceof prism.ConstantReadNode)) return null;
    parts.unshift(current.name);
    return { path: parts.join('::'), absolute: false };
  };

  const text = (node) => (node instanceof prism.StringNode || node instanceof prism.SymbolNode ? node.unescaped.value : null);
  const args = (call) => call.arguments_?.arguments_ ?? [];
  /** Keyword arguments of a call (`key: value` and `'key' => value`). */
  const keywords = (call) => {
    const found = new Map();
    for (const arg of args(call)) {
      if (!(arg instanceof prism.KeywordHashNode)) continue;
      for (const element of arg.elements) if (element instanceof prism.AssocNode && text(element.key) !== null) found.set(text(element.key), element.value);
    }
    return found;
  };

  /** A module or class whose body is only other modules and classes: a namespace, defined again in every file under it. */
  const isWrapper = (node) => {
    if (node instanceof prism.ClassNode && node.superclass) return false;
    const body = node.body instanceof prism.StatementsNode ? node.body.body : [];
    return body.length > 0 && body.every((statement) => statement instanceof prism.ClassNode || statement instanceof prism.ModuleNode);
  };

  // What each method call that names another file means. Keyed by the method name; a name not listed is ignored.
  const addRequire = (node) => {
    const [first] = args(node);
    if (first instanceof prism.StringNode) facts.requires.push({ spec: first.unescaped.value, relative: node.name === 'require_relative' });
  };

  const addAssociation = (node) => {
    const [first] = args(node);
    const keywordArgs = keywords(node);
    if (!(first instanceof prism.SymbolNode) || keywordArgs.has('polymorphic')) return;
    const className = keywordArgs.has('class_name') ? text(keywordArgs.get('class_name')) : null;
    // class_name: given as something else than a string (Foo.name): the constant walk below finds it
    if (className !== null || !keywordArgs.has('class_name')) {
      facts.associations.push({ macro: node.name, name: first.unescaped.value, className, scopes: scopes() });
    }
  };

  const addRender = (node) => {
    const target = keywords(node).get('inertia');
    if (target instanceof prism.StringNode) facts.renders.push({ component: target.unescaped.value, action });
    else if (target instanceof prism.HashNode || target instanceof prism.TrueNode) facts.renders.push({ component: null, action });
  };

  const addRoute = (node) => {
    const [first] = args(node);
    // routes: `inertia 'dashboard' => 'Dashboard'`, or `inertia 'about'` (component named like the path)
    if (first instanceof prism.KeywordHashNode) {
      const element = first.elements[0];
      if (element instanceof prism.AssocNode && text(element.key) !== null && element.value instanceof prism.StringNode) facts.routes.push(element.value.unescaped.value);
    } else if (text(first) !== null) facts.routes.push(text(first));
  };

  /** @type {Map<string, (node: any) => void>} method name -> what the call means */
  const callHandlers = new Map([
    ['require_relative', addRequire],
    ['require', addRequire],
    ...[...ASSOCIATIONS].map((macro) => [macro, addAssociation]),
    ['render', addRender],
    ['inertia', addRoute],
  ]);

  const handleCall = (node) => callHandlers.get(node.name)?.(node);

  const children = (node) => {
    for (const child of node.compactChildNodes()) walk(child);
  };

  /** `class X < Y` and `module X`: a definition, then its body inside it. */
  const walkDefinition = (node) => {
    if (node.superclass) walk(node.superclass);
    const constant = constPath(node.constantPath);
    if (!constant) return walk(node.body);
    const full = qualify(constant);
    facts.defs.push({ name: full, owner: !isWrapper(node) });
    stack.push(full);
    walk(node.body);
    stack.pop();
  };

  /** A constant read or a path (`A::B`): a reference, recorded once per lexical scope and name. */
  const walkConstant = (node) => {
    const constant = constPath(node);
    if (!constant) return children(node);
    const reference = { path: constant.path, scopes: constant.absolute ? [] : scopes() };
    const key = `${constant.absolute ? '::' : (reference.scopes[0] ?? '')}|${reference.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      facts.refs.push(reference);
    }
  };

  const walkConstantWrite = (node) => {
    facts.defs.push({ name: qualify({ path: node.name, absolute: false }), owner: true });
    walk(node.value);
  };

  const walkConstantPathWrite = (node) => {
    const constant = constPath(node.target);
    if (constant) facts.defs.push({ name: qualify(constant), owner: true });
    walk(node.value);
  };

  /** A method: calls inside it know its name (`action`), except singleton methods (`def self.x`). */
  const walkDef = (node) => {
    const outer = action;
    action = node.receiver ? null : node.name;
    children(node);
    action = outer;
  };

  // Nodes that need more than their children walked, by Prism class. Checked in order with instanceof, as the
  // classes are not compared by identity, so a subclass would still match.
  const nodeHandlers = new Map([
    [prism.ClassNode, walkDefinition],
    [prism.ModuleNode, walkDefinition],
    [prism.ConstantReadNode, walkConstant],
    [prism.ConstantPathNode, walkConstant],
    [prism.ConstantWriteNode, walkConstantWrite],
    [prism.ConstantPathWriteNode, walkConstantPathWrite],
    [prism.DefNode, walkDef],
  ]);

  const walk = (node) => {
    if (!node) return;
    for (const [nodeClass, handler] of nodeHandlers) {
      if (node instanceof nodeClass) return handler(node);
    }
    if (node instanceof prism.CallNode && !node.receiver) handleCall(node);
    children(node);
  };

  walk(result.value);
  return facts;
}
