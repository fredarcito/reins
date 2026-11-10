import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo, git } from './helpers.js';

const LOG = '.reins/progress/triage.log';
const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};
const head = (dir) => git(dir, 'rev-parse', 'HEAD').trim();
const commitAll = (dir, msg) => {
  git(dir, 'add', '-A', '--', '.', ':!.reins/progress');
  git(dir, 'commit', '-qm', msg);
};
const cart = (dir, names) => names.forEach((n) => write(dir, `src/features/cart/${n}.js`, `export const ${n} = 1;\n`));
const doctorRules = async (dir) => JSON.parse((await cli(dir, ['doctor', '--json'])).stdout).violations.map((v) => v.rule);

test('triage: appends the line with date, branch and the start commit; validates its input', async () => {
  const dir = exampleRepo('vite-react');
  git(dir, 'switch', '-qc', 'feat/cart');
  const r = await cli(dir, ['triage', 'medium', 'split', 'the', 'cart', '--task', 'cart-split', '--files', 'src/features/cart/Cart.jsx']);
  assert.equal(r.code, 0, r.stderr);
  const line = `2026-11-04 | feat/cart | medium | split the cart | commit:${head(dir).slice(0, 12)} | task:cart-split`;
  assert.equal(r.stdout, `Recorded in ${LOG}: ${line}\n`);
  write(dir, LOG, `${readFileSync(path.join(dir, LOG), 'utf8')}# no newline at the end`);
  await cli(dir, ['triage', 'large', 'it grew']);
  assert.deepEqual(readFileSync(path.join(dir, LOG), 'utf8').split('\n').slice(1), ['# no newline at the end', `2026-11-04 | feat/cart | large | it grew | commit:${head(dir).slice(0, 12)}`, '']);

  assert.equal((await cli(dir, ['triage', 'huge', 'x'])).code, 2);
  assert.match((await cli(dir, ['triage', 'small'])).stderr, /Expected a reason and --files/);
  // reins measures the level: below large, the files are required; the person's own level needs no measure
  const guess = await cli(dir, ['triage', 'small', 'just a guess']);
  assert.equal(guess.code, 2);
  assert.match(guess.stderr, /reins measures the level: pass --files .*Only `large` is accepted without files/s);
  const quick = await cli(dir, ['triage', 'small', 'the person said quick', '--override', '--files', 'src/features/cart/index.js']);
  assert.equal(quick.code, 0, quick.stderr);
  assert.doesNotMatch(quick.stdout, /raised/, 'the person decides: a public API does not raise it');
  assert.match((await cli(dir, ['triage', 'no level', '--override'])).stderr, /--override records the level the person chose/);
  assert.match((await cli(dir, ['triage', 'small', 'x', '--task', 'a b', '--files', 'src/x.js'])).stderr, /Task names use letters/);
});

test('triage --files: reins measures the level, raises a lower one, and the level becomes optional', async () => {
  const dir = exampleRepo('vite-react');
  git(dir, 'switch', '-qc', 'feat/cart');
  const last = () => readFileSync(path.join(dir, LOG), 'utf8').trim().split('\n').pop();

  // one file inside a domain: small stands
  let r = await cli(dir, ['triage', 'small', 'rename', '--files', 'src/features/cart/Cart.jsx']);
  assert.doesNotMatch(r.stdout, /raised|Tip/);
  assert.match(last(), / \| small \| rename \| /);

  // a public API: the declared level is raised, with the reason and what large asks for
  r = await cli(dir, ['triage', 'small', 'tweak the cart api', '--files', 'src/features/cart/index.js']);
  assert.match(r.stdout, /Level raised from small to large: touches a public API \(src\/features\/cart\/index\.js\)\./);
  assert.match(r.stdout, /Large: present the plan to the person and wait for confirmation before editing\./);
  assert.match(last(), / \| large \| tweak the cart api \| /);

  // a higher declared level is kept; a folder expands to its files; no level at all is measured
  r = await cli(dir, ['triage', 'large', 'rework', '--files', 'src/features/cart/Cart.jsx']);
  assert.doesNotMatch(r.stdout, /raised/);
  assert.match(last(), / \| large \| rework \| /);
  r = await cli(dir, ['triage', 'look at both features', '--files', 'src/features/cart,src/features/catalog']);
  assert.match(r.stdout, /Measured level: large \(2 domains \(cart, catalog\)/);
  assert.match(last(), / \| large \| look at both features \| /);
});

test('the level is measured on code: docs and tests come along; and drift is said while working, not at the end', async () => {
  const dir = exampleRepo('vite-react');
  git(dir, 'switch', '-qc', 'feat/cart');
  await cli(dir, ['triage', 'small', 'one fix', '--files', 'src/features/cart/Cart.jsx']);
  cart(dir, ['a']);
  for (const f of ['docs/cart.md', 'CHANGELOG.md', 'src/features/cart/a.test.js', 'test/cart.js', 'README.md']) write(dir, f, 'x\n');
  assert.ok(!(await doctorRules(dir)).includes('triage-mismatch'), '1 code file + 5 docs and tests is still small');

  cart(dir, ['b', 'c', 'd']);
  assert.ok((await doctorRules(dir)).includes('triage-mismatch'));
  await cli(dir, ['progress', 'new', 'fix']);
  const edit = await cli(dir, ['progress', 'add', 'another', 'step']);
  assert.match(edit.stdout, /! warning  Level declared .* is small.*looks medium: 4 files \(small allows 3\)/s, 'updating the notebook says the task grew');
  const again = await cli(dir, ['triage', 'small', 'still small?', '--files', 'src/features/cart/a.js']);
  assert.match(again.stdout, /! warning  Level declared .* looks medium/s, 'and so does triaging again below the diff');
  assert.doesNotMatch((await cli(dir, ['triage', 'medium', 'it grew', '--files', 'src/features/cart/a.js'])).stdout, /! warning/);
});

test('doctor: each task is compared with its own diff, so an older task neither hides nor inflates it', async () => {
  const dir = exampleRepo('vite-react');
  write(dir, '.reins/notes/cart.md', '---\npaths: ["src/features/cart/**"]\n---\n## Purpose\nThe cart.\n');
  commitAll(dir, 'note');
  git(dir, 'switch', '-qc', 'feat/cart');
  await cli(dir, ['triage', 'large', 'rework the cart']);
  cart(dir, ['a', 'b', 'c', 'd', 'e']);
  commitAll(dir, 'rework');
  write(dir, '.reins/notes/cart.md', '---\npaths: ["src/features/cart/**"]\n---\n## Purpose\nThe cart, reworked.\n');
  commitAll(dir, 'note');

  await cli(dir, ['triage', 'small', 'rename one function', '--files', 'src/features/cart/f.js']);
  cart(dir, ['f']);
  assert.deepEqual(await doctorRules(dir), [], 'the branch diff has 7 files, this task 1');
  const resume = (await cli(dir, ['resume'])).stdout;
  assert.match(resume, new RegExp(`## Files changed by the current task, since ${head(dir).slice(0, 7)} \\(1\\)\\n- src/features/cart/f\\.js\\n`));

  cart(dir, ['g', 'h', 'i']);
  assert.deepEqual(await doctorRules(dir), ['triage-mismatch', 'note-outdated'], 'the earlier large line no longer hides a bigger task');

  write(dir, LOG, `${readFileSync(path.join(dir, LOG), 'utf8')}2026-11-04 | feat/cart | small | rebased away | commit:0000000000aa\n`);
  assert.deepEqual(await doctorRules(dir), [], 'an unknown commit falls back to the branch diff and the highest level of the branch');
});

test('resume: drops the lines of gone branches and of tasks already in the base; keeps current work', async () => {
  const dir = exampleRepo('vite-react');
  const c0 = head(dir);
  git(dir, 'branch', 'feat/fresh');
  git(dir, 'switch', '-qc', 'feat/merged');
  cart(dir, ['merged']);
  commitAll(dir, 'merged work');
  git(dir, 'switch', '-q', 'main');
  git(dir, 'merge', '-q', '--ff-only', 'feat/merged');
  cart(dir, ['later']);
  commitAll(dir, 'later');
  const c1 = head(dir);
  git(dir, 'remote', 'add', 'origin', dir);
  git(dir, 'fetch', '-q', 'origin', 'feat/fresh:refs/remotes/origin/feat/pushed-only');
  const lines = [
    '# comment stays',
    '2026-11-01 | gone/branch | small | deleted branch',
    `2026-11-01 | main | small | landed on main | commit:${c0}`,
    `2026-11-01 | feat/merged | medium | merged feature | commit:${c0}`,
    `2026-11-01 | feat/fresh | medium | just branched | commit:${c0}`,
    '2026-11-01 | feat/pushed-only | small | only a remote-tracking ref',
    'unreadable line stays',
    `2026-11-02 | main | small | current task | commit:${c1}`,
  ];
  write(dir, LOG, `${lines.join('\n')}\n`);
  const before = JSON.parse((await cli(dir, ['doctor', '--json', '--base', 'main'])).stdout);
  assert.equal(readFileSync(path.join(dir, LOG), 'utf8'), `${lines.join('\n')}\n`, 'doctor ignores stale lines but never writes');
  assert.deepEqual(before.violations.map((v) => v.rule), ['triage-missing'], 'only the unreadable line');

  await cli(dir, ['resume']);
  assert.deepEqual(readFileSync(path.join(dir, LOG), 'utf8').split('\n'), [lines[0], lines[4], lines[5], lines[6], lines[7], '']);
});

test('triage: files after a quoted reason, separated by spaces, are all measured', async () => {
  const dir = exampleRepo('vite-react');
  cart(dir, ['a', 'b', 'c', 'd']);
  const files = ['a', 'b', 'c', 'd'].map((n) => `src/features/cart/${n}.js`);
  const r = await cli(dir, ['triage', 'split the cart', '--files', ...files]);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Measured level: medium \(4 files/);
  assert.match(readFileSync(path.join(dir, LOG), 'utf8'), /\| medium \| split the cart \|/, 'the files are not part of the reason');
});
