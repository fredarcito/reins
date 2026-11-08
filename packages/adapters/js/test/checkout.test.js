import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import adapter, { prepareCheckout } from '../src/index.js';

const mk = (...p) => mkdirSync(path.join(...p), { recursive: true });
const tmp = () => realpathSync(mkdtempSync(path.join(tmpdir(), 'reins-checkout-')));

/** A pnpm-like monorepo (main checkout) and a bare checkout of another commit with the same folders. */
function setup() {
  const main = tmp();
  const checkout = tmp();
  const outside = tmp();
  for (const root of [main, checkout]) {
    mk(root, 'packages/a');
    mk(root, 'packages/b');
    writeFileSync(path.join(root, 'packages/b/WHO'), root === main ? 'head' : 'base');
  }
  mk(main, 'packages/c/node_modules/plain'); // npm/hoisted layout: a real folder
  mk(checkout, 'packages/c');
  mk(main, 'packages/d/node_modules'); // package that does not exist at the other commit
  mk(main, 'node_modules/.pnpm/dep@1/node_modules/dep');
  mk(main, 'node_modules/.bin');
  mk(main, 'packages/a/node_modules/@t');
  mk(main, 'packages/a/node_modules/@ext');
  mk(main, 'packages/a/node_modules/.bin');
  mk(outside, 'lib');
  const a = path.join(main, 'packages/a/node_modules');
  symlinkSync('../../../node_modules/.pnpm/dep@1/node_modules/dep', path.join(a, 'dep')); // into the store
  symlinkSync('../../../b', path.join(a, '@t/b')); // pnpm workspace link: relative
  symlinkSync(path.join(main, 'packages/b'), path.join(a, '@t/abs')); // workspace link written as absolute
  symlinkSync(path.join(outside, 'lib'), path.join(a, '@ext/lib')); // outside the repo (npm link)
  symlinkSync(path.join(main, 'packages/b'), path.join(main, 'node_modules/b-root')); // root node_modules
  return { main, checkout, outside };
}

test('prepareCheckout: workspace links resolve to the checkout (base version), everything else to the main install', () => {
  const { main, checkout, outside } = setup();
  const { warnings } = prepareCheckout(checkout, main);
  assert.deepEqual(warnings, []);
  const a = path.join(checkout, 'packages/a/node_modules');

  // pnpm relative workspace link: recreated with the same relative target → the checkout's own package
  assert.equal(readlinkSync(path.join(a, '@t/b')), '../../../b');
  assert.equal(realpathSync(path.join(a, '@t/b')), path.join(checkout, 'packages/b'));
  // absolute workspace link: pointed at the checkout's copy, not at the main checkout
  assert.equal(realpathSync(path.join(a, '@t/abs')), path.join(checkout, 'packages/b'));
  // root node_modules is mirrored too
  assert.equal(realpathSync(path.join(checkout, 'node_modules/b-root')), path.join(checkout, 'packages/b'));
  // a link into the pnpm store (inside the repo but under node_modules) and one outside the repo: absolute, main's install
  assert.equal(realpathSync(path.join(a, 'dep')), path.join(main, 'node_modules/.pnpm/dep@1/node_modules/dep'));
  assert.equal(realpathSync(path.join(a, '@ext/lib')), path.join(outside, 'lib'));
  // a real folder (npm layout) and the pnpm store itself: absolute links to the main checkout
  assert.equal(realpathSync(path.join(checkout, 'packages/c/node_modules/plain')), path.join(main, 'packages/c/node_modules/plain'));
  assert.equal(realpathSync(path.join(checkout, 'node_modules/.pnpm')), path.join(main, 'node_modules/.pnpm'));
});

test('prepareCheckout: @scope folders and node_modules are real directories, whole folders are never linked', () => {
  const { main, checkout } = setup();
  prepareCheckout(checkout, main);
  for (const d of ['packages/a/node_modules', 'packages/a/node_modules/@t', 'packages/a/node_modules/@ext', 'node_modules']) {
    const st = lstatSync(path.join(checkout, d));
    assert.ok(st.isDirectory() && !st.isSymbolicLink(), `${d} is a real directory`);
  }
});

test('prepareCheckout: skips .bin, packages that do not exist at that commit, and never overwrites', () => {
  const { main, checkout } = setup();
  prepareCheckout(checkout, main);
  assert.ok(!existsSync(path.join(checkout, 'packages/a/node_modules/.bin')));
  assert.ok(!existsSync(path.join(checkout, 'node_modules/.bin')));
  assert.ok(!existsSync(path.join(checkout, 'packages/d')), 'no folder is invented for a package the commit does not have');
  assert.doesNotThrow(() => prepareCheckout(checkout, main), 'running it twice is harmless');
});

test('prepareCheckout: Yarn Plug\'n\'Play has no node_modules: it warns that the base graph is unsupported and links nothing', () => {
  const { main, checkout } = setup();
  writeFileSync(path.join(main, '.pnp.cjs'), '');
  const { warnings } = prepareCheckout(checkout, main);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Plug'n'Play.*base graph is unsupported/);
  assert.ok(!existsSync(path.join(checkout, 'node_modules')));
});

test('prepareCheckout: follows a root node_modules that is a link; skips build and cache folders', () => {
  const { main, checkout } = setup();
  const store = tmp();
  mk(store, 'dep');
  mk(main, 'packages/a/dist/node_modules/junk');
  mk(checkout, 'packages/a/dist');
  mk(main, 'packages/b/node_modules');
  symlinkSync(store, path.join(main, 'packages/b/node_modules/via'));
  // replace the root node_modules by a link to a folder elsewhere
  const linked = tmp();
  mk(linked, '.pnpm');
  symlinkSync(path.join(main, 'packages/b'), path.join(linked, 'ws'));
  rmSync(path.join(main, 'node_modules'), { recursive: true });
  symlinkSync(linked, path.join(main, 'node_modules'));
  const { warnings } = prepareCheckout(checkout, main);
  assert.deepEqual(warnings, []);
  assert.equal(realpathSync(path.join(checkout, 'node_modules/ws')), path.join(checkout, 'packages/b'), 'a workspace link inside a linked node_modules still resolves to the checkout');
  assert.equal(realpathSync(path.join(checkout, 'node_modules/.pnpm')), path.join(linked, '.pnpm'));
  assert.ok(!existsSync(path.join(checkout, 'packages/a/dist/node_modules')), 'build folders are skipped');
});

test('the adapter exposes prepareCheckout (optional contract field)', () => {
  assert.equal(adapter.prepareCheckout, prepareCheckout);
});
