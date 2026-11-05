// Reading reins files of a consumer repo, shared by several commands. None of this needs the adapter.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { CORE_RULES, ConfigError, parseConfig, parseDoctorConfig, parseNote, isNoteFile, NOTES_DIR } from '@agentreins/core';
import { ARCHITECTURE_FILE, CliError, REINS_DIR, isGitRepo } from './context.js';

export const DOCTOR_FILE = `${REINS_DIR}/doctor.yml`;

/** Text of a repo file, or null. */
export const readText = (root, f) => (existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), 'utf8') : null);

/**
 * Domains from architecture.yml without loading the adapter (unknown rule ids are accepted).
 * @param {string} root
 * @param {string[]} notes collects explanations when domains can't be read
 */
export function readDomains(root, notes) {
  const text = readText(root, ARCHITECTURE_FILE);
  if (text === null) {
    notes.push(`${ARCHITECTURE_FILE} not found: domains are unknown.`);
    return [];
  }
  const ids = [...text.matchAll(/\bid:\s*["']?([\w-]+)/g)].map((m) => m[1]);
  try {
    return parseConfig(text, { file: ARCHITECTURE_FILE, knownRules: [...new Set([...CORE_RULES, ...ids])] }).domains;
  } catch {
    notes.push(`${ARCHITECTURE_FILE} is not valid, so domains are unknown (run \`reins check\` to see why).`);
    return [];
  }
}

/** doctor.yml thresholds (defaults when missing). Throws CliError when invalid. */
export function readDoctorConfig(root) {
  try {
    return parseDoctorConfig(readText(root, DOCTOR_FILE), { file: DOCTOR_FILE });
  } catch (e) {
    if (e instanceof ConfigError) throw new CliError(e.message);
    throw e;
  }
}

/**
 * Every module note in .reins/notes/ and its folders (parts of a module: `<module>/<part>.md`), sorted by path.
 * Folders and files starting with "_" or "." are skipped. Deeper folders are read too; doctor flags them.
 * @returns {{ notes: import('@agentreins/core').Note[], problems: string[] }}
 */
export function loadNotes(root) {
  const notes = [];
  const problems = [];
  const visit = (rel) => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (/^[_.]/.test(entry.name)) continue;
      const file = `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else if (isNoteFile(entry.name)) {
        const { note, problem } = parseNote(file, readFileSync(path.join(root, file), 'utf8'));
        if (note) notes.push(note);
        else problems.push(problem);
      }
    }
  };
  if (existsSync(path.join(root, NOTES_DIR))) visit(NOTES_DIR);
  notes.sort((a, b) => (a.file < b.file ? -1 : 1));
  return { notes, problems };
}

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage']);

/** Every file under a repo folder (repo-relative), skipping build output, dependencies and dot folders. */
export function walk(root, rel = '') {
  const out = [];
  for (const name of readdirSync(path.join(root, rel)).sort()) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(root, r)).isDirectory()) out.push(...walk(root, r));
    else out.push(r);
  }
  return out;
}

const git = (root, args) => execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 });

/** Files of the repo: tracked and untracked but not ignored (git), or a walk of the folder (no git). */
export function listRepoFiles(root) {
  if (!isGitRepo(root)) return walk(root);
  return git(root, ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter((f) => f && existsSync(path.join(root, f)));
}

/**
 * Recent commits, newest first, with the files each one changed. Empty outside git or without commits.
 * @returns {{ hash: string, date: string, files: string[] }[]}
 */
export function readHistory(root, max = 5000) {
  if (!isGitRepo(root)) return [];
  let text;
  try {
    text = git(root, ['log', '--no-merges', '-n', String(max), '--format=%x00%H%x09%cs', '--name-only']);
  } catch {
    return []; // no commits yet
  }
  return text.split('\0').filter(Boolean).map((chunk) => {
    const [head, ...files] = chunk.split('\n');
    const [hash, date] = head.split('\t');
    return { hash, date, files: files.filter(Boolean) };
  });
}

/** Files with uncommitted changes (staged, unstaged or untracked). */
export function dirtyFiles(root) {
  if (!isGitRepo(root)) return [];
  return git(root, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, ''));
}
