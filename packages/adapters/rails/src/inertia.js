// Inertia (inertia_rails): a controller renders a page component by name, and the client resolves that name to a
// file under the pages folder. That is the one place where Ruby depends on a frontend file, so it becomes an edge.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const PAGE_FILE = /\.(tsx|jsx|ts|js|vue|svelte)$/;
/** Folders the frontend lives in: vite_rails' default, then the classic one. */
const SOURCE_DIRS = ['app/frontend', 'app/javascript'];

/**
 * @typedef {{ roots: string[], find: (component: string) => string | null, customResolver: boolean }} InertiaPages
 */

/**
 * @param {string} root real path of the repo
 * @returns {InertiaPages | null} null when the app does not use inertia_rails
 */
export function readInertia(root) {
  const gemfile = path.join(root, 'Gemfile');
  if (!existsSync(gemfile) || !/inertia_rails/.test(readFileSync(gemfile, 'utf8'))) return null;

  const sourceDirs = [...SOURCE_DIRS];
  try {
    const dir = JSON.parse(readFileSync(path.join(root, 'config/vite.json'), 'utf8')).all?.sourceCodeDir;
    if (typeof dir === 'string' && dir) sourceDirs.unshift(dir.replace(/^\.?\/+|\/+$/g, ''));
  } catch {
    /* no config/vite.json: the defaults apply */
  }

  const roots = [];
  /** @type {Map<string, string>} component name -> page file, relative to the repo */
  const pages = new Map();
  /** @type {Map<string, string>} the same, by lower-cased name */
  const folded = new Map();
  for (const sourceDir of new Set(sourceDirs)) {
    // names as they are on disk: on a case-insensitive file system `pages` and `Pages` are the same folder
    for (const name of list(path.join(root, sourceDir)).filter((e) => e.isDirectory() && /^pages$/i.test(e.name)).map((e) => e.name)) {
      const pagesRoot = `${sourceDir}/${name}`;
      roots.push(pagesRoot);
      walk(path.join(root, pagesRoot), '', (rel) => {
        if (!PAGE_FILE.test(rel)) return;
        const component = rel.replace(PAGE_FILE, '');
        if (!pages.has(component)) pages.set(component, `${pagesRoot}/${rel}`);
        if (!folded.has(component.toLowerCase())) folded.set(component.toLowerCase(), `${pagesRoot}/${rel}`);
      });
    }
  }

  return {
    roots,
    // exact name first; then ignoring case, because an inferred name is always lower case (`users/show`)
    find: (component) => pages.get(component) ?? folded.get(component.toLowerCase()) ?? null,
    customResolver: usesCustomResolver(root),
  };
}

/** `component_path_resolver` changes how a controller and action map to a component: inferred names can't be followed. */
function usesCustomResolver(root) {
  let found = false;
  for (const dir of ['config/initializers', 'app/controllers']) {
    walk(path.join(root, dir), '', (rel) => {
      if (found || !rel.endsWith('.rb')) return;
      const source = readFileSync(path.join(root, dir, rel), 'utf8').replace(/^\s*#.*$/gm, '');
      if (/component_path_resolver/.test(source)) found = true;
    });
  }
  return found;
}

/**
 * The component inertia_rails infers when `render inertia:` names none: the controller path plus the action
 * (`app/controllers/admin/users_controller.rb#show` -> `admin/users/show`).
 * @param {string} file controller file, relative to the repo
 * @param {string} action
 * @returns {string | null}
 */
export function inferredComponent(file, action) {
  const m = /(?:^|\/)controllers\/(.+)_controller\.rb$/.exec(file);
  return m ? `${m[1]}/${action}` : null;
}

function list(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function walk(dir, rel, visit) {
  for (const entry of list(dir)) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(path.join(dir, entry.name), next, visit);
    else visit(next);
  }
}
