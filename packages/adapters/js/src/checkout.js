// prepareCheckout: makes a bare checkout of another commit (a git worktree) resolvable, without installing anything.
// It mirrors every node_modules of the main checkout entry by entry. Workspace links (a symlink whose target is
// a package inside the repo) are recreated relative to the checkout, so they resolve to its own copy (the other
// commit's code). Everything else points by absolute path at the main checkout's install.
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, statSync, symlinkSync } from 'node:fs';
import path from 'node:path';

// Folders that hold build output or caches, never a package's own node_modules worth mirroring.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.reins', '.next', '.nuxt', '.svelte-kit', '.turbo', '.nx', '.cache', '.yarn', 'dist', 'build', 'out', 'coverage']);

/**
 * @param {string} checkoutDir
 * @param {string} repoRoot
 * @returns {{ warnings: string[] }}
 */
export function prepareCheckout(checkoutDir, repoRoot) {
  const warnings = [];
  const root = realpathSync(repoRoot);
  const checkout = realpathSync(checkoutDir);
  if (existsSync(path.join(root, '.pnp.cjs')) || existsSync(path.join(root, '.pnp.js'))) {
    warnings.push('Yarn Plug\'n\'Play (no node_modules): the base graph is unsupported, imports between packages may look new.');
    return { warnings };
  }
  let failed = 0;
  for (const rel of findNodeModules(root, root, [], () => failed++)) {
    const parent = path.join(checkout, path.dirname(rel));
    if (!existsSync(parent)) continue; // the package does not exist at that commit
    mirror(path.join(root, rel), path.join(checkout, rel), root, checkout, () => failed++);
  }
  if (failed) warnings.push(`${failed} node_modules entries could not be read or linked: imports through them may look new.`);
  return { warnings };
}

/** Repo-relative paths of every node_modules folder (or link to one) that is not inside another one. */
function findNodeModules(root, dir, out, onError) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    onError();
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules') {
      // a root node_modules may itself be a link to a folder elsewhere: follow it
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        try { isDir = statSync(path.join(dir, e.name)).isDirectory(); } catch { isDir = false; }
      }
      if (isDir) out.push(path.relative(root, path.join(dir, e.name)));
    } else if (e.isDirectory() && !SKIP_DIRS.has(e.name)) findNodeModules(root, path.join(dir, e.name), out, onError);
  }
  return out;
}

function mirror(src, dest, root, checkout, onError) {
  mkdirSync(dest, { recursive: true });
  let names;
  try {
    names = readdirSync(src);
  } catch {
    onError();
    return;
  }
  for (const name of names) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    if (existsSync(to) || name === '.bin') continue;
    try {
      const st = lstatSync(from);
      if (st.isSymbolicLink()) {
        let target;
        try { target = realpathSync(from); } catch { continue; } // dangling link
        const rel = path.relative(root, target);
        const inRepo = !rel.startsWith('..') && !path.isAbsolute(rel);
        const workspace = inRepo && !rel.split(path.sep).includes('node_modules');
        // a workspace link points at the checkout's copy, relative like pnpm writes it
        symlinkSync(workspace ? path.relative(path.dirname(to), path.join(checkout, rel)) : target, to);
      } else if (st.isDirectory() && name.startsWith('@')) mirror(from, to, root, checkout, onError);
      else symlinkSync(from, to); // real dir or file (npm/hoisted layout, pnpm's .pnpm store)
    } catch {
      onError();
    }
  }
}
