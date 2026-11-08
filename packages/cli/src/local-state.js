// Safe updates of small local state files under .reins/ that several processes may touch at the same time
// (Claude Code runs one hook per tool call, and parallel tool calls run their hooks in parallel).
// Synchronous on purpose: hooks are short-lived processes and the callers are synchronous.
import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const sleeper = new Int32Array(new SharedArrayBuffer(4));
const sleep = (ms) => Atomics.wait(sleeper, 0, 0, ms);

/**
 * Writes `data` to `file` so that readers never see a partial file: write a temporary file next to it, then rename.
 * @param {string} file absolute path
 * @param {string} data
 */
export function writeFileAtomic(file, data) {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    writeFileSync(tmp, data);
    renameSync(tmp, file);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* already gone */
    }
    throw e;
  }
}

/**
 * Runs `fn` while holding `<file>.lock`, so a read-modify-write of `file` is not interleaved with another process.
 * Never blocks for long: after `timeoutMs` it runs `fn` without the lock (callers must tolerate a rare race, such as a
 * note delivered twice). A lock older than `staleMs` belongs to a process that died and is removed.
 * @template T
 * @param {string} file absolute path of the state file
 * @param {() => T} fn
 * @param {{ timeoutMs?: number, staleMs?: number }} [opts]
 * @returns {T}
 */
export function withFileLock(file, fn, { timeoutMs = 200, staleMs = 5000 } = {}) {
  const lock = `${file}.lock`;
  const deadline = Date.now() + timeoutMs;
  let fd = null;
  try {
    mkdirSync(path.dirname(lock), { recursive: true });
  } catch {
    return fn();
  }
  while (fd === null) {
    try {
      fd = openSync(lock, 'wx');
    } catch (e) {
      if (e.code !== 'EEXIST') return fn(); // read-only checkout or similar: no lock possible
      try {
        if (Date.now() - statSync(lock).mtimeMs > staleMs) unlinkSync(lock);
      } catch {
        /* released meanwhile */
      }
      if (Date.now() >= deadline) return fn();
      sleep(5);
    }
  }
  try {
    return fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lock);
    } catch {
      /* removed as stale by another process */
    }
  }
}
