// Reading reins files of a consumer repo, shared by several commands. None of this needs the adapter.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  CORE_RULES, ConfigError, parseConfig, parseDoctorConfig, parseNote, isNoteFile, NOTES_DIR, PROGRESS_DIR, NOTEBOOK_NAME, branchFolder,
} from '@agentreins/core';
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

/**
 * The paths among `paths` that git ignores: untracked and matched by .gitignore (a tracked file never is, even if a
 * rule matches it). Empty outside git or when git fails.
 * @param {string} root
 * @param {string[]} paths repo-relative
 * @returns {Set<string>}
 */
export function ignoredPaths(root, paths) {
  if (!isGitRepo(root) || !paths.length) return new Set();
  try {
    const text = execFileSync('git', ['check-ignore', '--stdin', '-z'], { cwd: root, input: paths.join('\0'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    return new Set(text.split('\0').filter(Boolean));
  } catch {
    return new Set(); // exit 1: none ignored
  }
}

/** Files with uncommitted changes (staged, unstaged or untracked). */
export function dirtyFiles(root) {
  if (!isGitRepo(root)) return [];
  return git(root, ['status', '--porcelain', '--untracked-files=all']).split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^.* -> /, ''));
}

const LOCAL_DIRS = [`${REINS_DIR}/progress/`, `${REINS_DIR}/backlog/`];

/**
 * Files changed on this branch (committed, staged, unstaged and untracked), without reins' local folders.
 * @param {string} root
 * @param {{ base?: string | null, since?: string }} from `since`: a commit (the diff since it); `base`: a base ref
 *   (the diff since the merge base with it); neither: uncommitted changes only.
 */
export function changedFiles(root, { base = null, since } = {}) {
  const start = since ?? (base ? git(root, ['merge-base', 'HEAD', base]).trim() : 'HEAD');
  const tracked = git(root, ['diff', '--name-only', start]).split('\n');
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).split('\n');
  return [...new Set([...tracked, ...untracked])].filter((f) => f && !LOCAL_DIRS.some((d) => f.startsWith(d))).sort();
}

/**
 * Branches that still exist, each with a ref to its tip: local branches, plus remote-tracking refs (`origin/x` → `x`)
 * so a branch deleted locally whose PR is still open counts as live. The current branch always counts, even before
 * its first commit. Shared by the triage.log cleanup and the notebook cleanup.
 * @returns {Map<string, string>} branch name → ref
 */
export function liveBranches(root) {
  const live = new Map();
  if (!isGitRepo(root)) return live;
  const refs = (prefix) => {
    try {
      return git(root, ['for-each-ref', '--format=%(refname)', prefix]).split('\n').filter(Boolean);
    } catch {
      return [];
    }
  };
  for (const ref of refs('refs/remotes/')) {
    const name = ref.split('/').slice(3).join('/');
    if (name && name !== 'HEAD') live.set(name, ref);
  }
  for (const ref of refs('refs/heads/')) live.set(ref.slice('refs/heads/'.length), ref);
  try {
    live.set(git(root, ['rev-parse', '--abbrev-ref', 'HEAD']).trim(), 'HEAD');
  } catch {
    try {
      live.set(git(root, ['symbolic-ref', '--short', 'HEAD']).trim(), 'HEAD'); // no commits yet
    } catch {
      /* not on a branch */
    }
  }
  return live;
}

/**
 * @typedef {{ folder: string, task: string | null, file: string, dir: string | null, text: string, changed: string }} NotebookEntry
 *   `folder`: the branch folder name; `task`: null for the older per-branch notebook; `dir`: the task folder (its cold
 *   files), or the branch folder for the older notebook when it exists; `changed`: date the file last changed (UTC)
 */

/**
 * Progress notebooks: `<branch>/<task>/notebook.md` and the older `<branch>.md`, of one branch or of every branch.
 * The tasks of a branch are the subfolders of its folder that contain a notebook.md; plain files there are cold
 * files of the older notebook, never tasks.
 * @param {string} root
 * @param {string} [branch] only this branch
 * @returns {NotebookEntry[]}
 */
export function listNotebooks(root, branch) {
  const base = path.join(root, PROGRESS_DIR);
  if (!existsSync(base)) return [];
  const only = branch === undefined ? null : branchFolder(branch).slice(PROGRESS_DIR.length + 1);
  const entries = readdirSync(base, { withFileTypes: true }).filter((e) => !/^[_.]/.test(e.name));
  const out = [];
  const add = (folder, task, rel, dir) => {
    const abs = path.join(root, rel);
    out.push({ folder, task, file: rel, dir, text: readFileSync(abs, 'utf8'), changed: statSync(abs).mtime.toISOString().slice(0, 10) });
  };
  const folders = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('.md')) {
      const folder = e.name.slice(0, -3);
      if (only === null || folder === only) add(folder, null, `${PROGRESS_DIR}/${e.name}`, folders.has(folder) ? `${PROGRESS_DIR}/${folder}` : null);
    } else if (e.isDirectory() && (only === null || e.name === only)) {
      for (const t of readdirSync(path.join(base, e.name), { withFileTypes: true })) {
        const rel = `${PROGRESS_DIR}/${e.name}/${t.name}`;
        if (t.isDirectory() && !/^[_.]/.test(t.name) && existsSync(path.join(root, rel, NOTEBOOK_NAME))) add(e.name, t.name, `${rel}/${NOTEBOOK_NAME}`, rel);
      }
    }
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : 1));
}
