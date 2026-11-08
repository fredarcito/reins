import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { tempDir } from './helpers.js';
import { withFileLock, writeFileAtomic } from '../src/local-state.js';
import { SEEN_FILE, takeUnseen } from '../src/notes-seen.js';

const seenModule = pathToFileURL(path.join(import.meta.dirname, '../src/notes-seen.js')).href;

/** One hook process: waits until `startAt` (so all of them collide), asks for the same notes, prints how many it got. */
function hookProcess(root, session, notes, startAt) {
  const script = `import { takeUnseen } from ${JSON.stringify(seenModule)};
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.max(0, ${startAt} - Date.now()));
process.stdout.write(String(takeUnseen(${JSON.stringify(root)}, ${JSON.stringify(session)}, ${JSON.stringify(notes)}).length));`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script]);
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Number(out)) : reject(new Error(`hook process exited ${code}`))));
  });
}

test('parallel hooks deliver each note once per session and never corrupt the seen-notes file', async () => {
  const root = tempDir();
  // earlier sessions make the file long, so an interleaved write would leave garbage behind
  const earlier = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`old-${i}`, ['.reins/notes/a.md', '.reins/notes/b.md']]));
  writeFileAtomic(path.join(root, SEEN_FILE), JSON.stringify(earlier));
  const notes = [{ file: '.reins/notes/cli.md' }];

  const startAt = Date.now() + 1500;
  const given = await Promise.all(Array.from({ length: 8 }, () => hookProcess(root, 'parallel', notes, startAt)));

  assert.equal(given.reduce((a, b) => a + b, 0), 1, `the note was delivered ${given.join('+')} times`);
  const seen = JSON.parse(readFileSync(path.join(root, SEEN_FILE), 'utf8'));
  assert.deepEqual(seen.parallel, ['.reins/notes/cli.md']);
  assert.equal(Object.keys(seen).length, 21, 'other sessions keep their record');
  assert.deepEqual(readdirSync(path.dirname(path.join(root, SEEN_FILE))).filter((f) => /\.(tmp|lock)$/.test(f)), [], 'no temporary or lock file left');
});

test('a corrupted seen-notes file is replaced by a valid one', () => {
  const root = tempDir({ [SEEN_FILE]: '{"s1":[".reins/notes/a.md"]}}' });
  assert.equal(takeUnseen(root, 's2', [{ file: '.reins/notes/a.md' }]).length, 1);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, SEEN_FILE), 'utf8')), { s2: ['.reins/notes/a.md'] });
});

test('withFileLock never waits long: a held lock times out, a stale one is removed', () => {
  const root = tempDir();
  const file = path.join(root, 'state.json');
  writeFileSync(`${file}.lock`, '');

  const start = Date.now();
  assert.equal(withFileLock(file, () => 'ran', { timeoutMs: 50 }), 'ran', 'runs without the lock after the timeout');
  assert.ok(Date.now() - start < 1000);
  assert.ok(existsSync(`${file}.lock`), "another process's fresh lock is left alone");

  const old = new Date(Date.now() - 60_000);
  utimesSync(`${file}.lock`, old, old);
  assert.equal(withFileLock(file, () => existsSync(`${file}.lock`)), true, 'takes over a stale lock and holds it while running');
  assert.equal(existsSync(`${file}.lock`), false, 'releases it afterwards');
});
