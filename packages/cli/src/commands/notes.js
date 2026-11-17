// reins notes <path…>: prints the module notes that apply to a path.
// reins notes --hook: the same, as a Claude Code PreToolUse hook (JSON in on stdin, JSON out), at most once
// per note and session. It never blocks the agent: any problem means "no note".
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { matchesAny, notesFor, NOTES_DIR, rankStaleNotes } from '@agentreins/core';
import { CliError, hookEventName, isGitRepo, toRepoPath } from '../context.js';
import { impactHint, untriagedHint } from '../impact-map.js';
import { sessionId } from '../notebooks.js';
import { takeUnseen } from '../notes-seen.js';
import { writeNoteDraft } from '../notes-draft.js';
import { dirtyFiles, loadNotes, readDomains, readHistory, walk } from '../project.js';
import { analyze } from './check.js';

export { SEEN_FILE } from '../notes-seen.js';

export const options = {
  hook: { type: 'boolean' },
  json: { type: 'boolean' },
  paths: { type: 'string' },
  name: { type: 'string' },
  force: { type: 'boolean' },
  limit: { type: 'string' },
};
export const positionals = true;

export const help = `Usage: reins notes <path…> [--json]
       reins notes new <domain|folder> [--name <name>] [--paths <glob,…>] [--force]
       reins notes stale [--limit <n>] [--json]
       reins notes --hook

Prints the module notes (.reins/notes/*.md) whose "paths" match each path.

new     Drafts .reins/notes/<name>.md for a domain of architecture.yml or a folder: the import graph fills in
        the public API, the most imported files, who uses the module and what it depends on; the rest are TODO
        lines for the agent or a person to fill in. A folder inside a domain is a part of it and its note goes
        to .reins/notes/<domain>/<part>.md. --name sets the file name (<name> or <module>/<part>; default: the
        domain or the folder name), --paths overrides the globs, --force overwrites.
stale   Lists the notes most behind their code: commits to a note's paths since the note last changed (from
        git history). A signal, not proof: review the top ones (in Claude Code: /reins-notes review).
        --limit shows the first <n> (default 10; 0 for all).
--hook  For the Claude Code PreToolUse hook that reins sync installs (Read, Edit, Write, Grep, Glob, Bash; Shell in Cursor): reads
        the tool call from stdin and returns the notes of its file or folder (for Bash, of the paths the command
        names) as additional context, once per note and session. The first edit of a session that has not
        measured its task's level also gets a reminder to run reins triage --files.`;

/** reins notes new <domain|folder> */
async function newNote(ctx, target) {
  const { root, cwd, values, out } = ctx;
  const info = [];
  const domains = readDomains(root, info);
  const domain = domains.find((d) => d.name === target);
  let name;
  let paths;
  let api = [];
  if (domain) {
    name = domain.name;
    paths = domain.paths;
    api = domain.publicApi;
  } else {
    const rel = toRepoPath(root, cwd, target).replace(/\/$/, '');
    if (!existsSync(path.join(root, rel)) || !statSync(path.join(root, rel)).isDirectory()) {
      const known = domains.map((d) => d.name).join(', ');
      throw new CliError(`"${target}" is not a domain of architecture.yml nor a folder.${known ? ` Domains: ${known}.` : ''}`);
    }
    // a folder inside a domain is a part of it: its note goes to .reins/notes/<domain>/<part>.md
    const owner = domains.find((d) => matchesAny(`${rel}/x.js`, d.paths) && !d.paths.includes(`${rel}/**`));
    const base = path.basename(rel).replace(/^\((.+)\)$/, '$1').replace(/[^\w.-]/g, '-');
    name = owner ? `${owner.name}/${base}` : base;
    paths = [`${rel}/**`];
    api = [`${rel}/index.{js,jsx,ts,tsx}`];
  }
  if (values.paths) paths = values.paths.split(',').map((p) => p.trim()).filter(Boolean);
  if (values.name) {
    if (!/^[\w-][\w.-]*(\/[\w-][\w.-]*)?$/.test(values.name)) {
      throw new CliError(`--name must be a file name (letters, digits, ".", "_", "-"), or <module>/<part> for a part of a module, got "${values.name}".`);
    }
    name = values.name.replace(/\.md$/, '');
  }
  const file = `${NOTES_DIR}/${name}.md`;
  if (existsSync(path.join(root, file)) && !values.force) {
    throw new CliError(`${file} already exists. Edit it, or pass --force to replace it with a new draft.`);
  }

  let graph = null;
  let files = [];
  try {
    graph = (await analyze(root, { searchPaths: ctx.adapterSearchPaths })).graph;
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    out(`! warning  Could not build the import graph, so the Map only lists the public API: ${e.message.split('\n')[0]}`);
    files = walk(root);
  }
  const date = ctx.today ?? new Date().toISOString().slice(0, 10);
  const r = writeNoteDraft(root, { name, paths, publicApi: api }, graph, files, domains, date, { force: true });
  if (r.empty) out(`! warning  No file matches ${paths.join(', ')}.`);
  out(`Drafted ${file}. Run \`reins sync\` to add it to the AGENTS.md index, then ask your agent to fill in its TODO lines (in Claude Code: /reins-notes).`);
  return 0;
}

/** reins notes stale */
function staleNotes(ctx) {
  const { root, values, out } = ctx;
  if (!isGitRepo(root)) throw new CliError('reins notes stale reads the git history: run it inside a git repository.');
  const limit = values.limit === undefined ? 10 : Number(values.limit);
  if (!Number.isInteger(limit) || limit < 0) throw new CliError(`--limit must be a whole number ≥ 0, got "${values.limit}".`);
  const { notes: all, problems } = loadNotes(root);
  const ranked = rankStaleNotes(all, readHistory(root), { dirty: dirtyFiles(root) });
  const shown = limit ? ranked.slice(0, limit) : ranked;
  if (values.json) {
    out(JSON.stringify({ problems, notes: shown }, null, 2));
    return 0;
  }
  for (const pr of problems) out(`! warning  ${pr}`);
  if (!all.length) {
    out('No module notes in .reins/notes/.');
    return 0;
  }
  const behind = ranked.filter((e) => e.commits > 0).length;
  out(`reins notes stale: ${behind} of ${all.length} notes have commits to their paths since they last changed.`);
  for (const e of shown) {
    let why;
    if (e.lastChange === null) why = 'never committed';
    else if (e.uncommitted) why = 'being edited';
    else why = `${e.commits} commit(s), ${e.files} file(s) since ${e.lastChange}`;
    out(`  ${e.file}  ${why}`);
  }
  if (ranked.length > shown.length) out(`  … ${ranked.length - shown.length} more (--limit 0 for all)`);
  if (behind) out('Review the top ones against the code (in Claude Code: /reins-notes review): fix what is no longer true.');
  return 0;
}

/** Formats notes for a path, for people and agents alike. */
export const render = (file, notes) =>
  notes.map((n) => `Note ${n.file} (applies to ${n.paths.join(', ')}) for ${file}:\n${n.body}`).join('\n\n');

/** Reads all of stdin. */
async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

/** Tools that change a file: the first one in a session without a measured level gets the triage reminder. */
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch']);
/** Shell tools: Claude Code's `Bash`, Cursor's `Shell` (VERIFIED P12). Both send `tool_input.command`. */
const SHELL_TOOLS = new Set(['Bash', 'Shell']);
/** At most this many paths of one shell command get their notes: a long `find` or `ls` output is not the task. */
export const MAX_SHELL_PATHS = 8;

/**
 * git subcommands that only move changes around (stage, commit, switch branches, stash…): they name paths without
 * reading or changing the code in them, so their paths bring no notes. `git diff`, `git log`, `git show`, `git
 * blame`, `git mv` and `git rm` are not here: they read or change code.
 */
const GIT_BOOKKEEPING = new Set(['add', 'commit', 'restore', 'checkout', 'switch', 'stash', 'reset', 'clean', 'push', 'pull', 'fetch', 'branch', 'tag']);
/** git options before the subcommand that take a value (`git -C dir add x`). */
const GIT_OPTIONS_WITH_VALUE = new Set(['-C', '-c']);

/** Whether a command's words are a git command that only moves changes around (GIT_BOOKKEEPING). */
function isGitBookkeeping(words) {
  if (words[0] !== 'git') return false;
  let index = 1;
  while (words[index]?.startsWith('-')) index += GIT_OPTIONS_WITH_VALUE.has(words[index]) ? 2 : 1;
  return GIT_BOOKKEEPING.has(words[index]);
}

/** Real path; for a file about to be created (it doesn't exist yet), its resolved path. */
function realPath(target) {
  try {
    return realpathSync(target);
  } catch {
    return path.resolve(target);
  }
}

/**
 * Where a shell command's words split into candidate paths: blanks, and the quotes, brackets, commas and `=` of
 * code passed inline, so `python3 -c "open('src/x.js','w')"` or `--out=src/x.js` yield `src/x.js`.
 */
const SHELL_TOKEN_SEPARATORS = /[\s'"`()[\]{},;=]+/;
/** A redirection, alone (`> f`) or glued to its target (`>f`, `2>>f`, `&>f`). */
const REDIRECTION = /^(?:\d*>>?|&>)/;
/** Commands whose arguments are files they write, even new ones. */
const WRITING_COMMANDS = new Set(['tee', 'touch']);

/**
 * The paths a shell command names, e.g. `sed -n 1,80p src/x.js`, `grep -rn foo packages/cli`, `cd packages/cli &&
 * cat src/a.js` (`src/a.js` resolved from `packages/cli`), `sed -i … src/x.js`, `python3 -c "open('src/x.js','w')…"`
 * or `cat > src/new.js <<EOF`. Any command: what matters is which code the agent is about to read or change, and
 * words that are not paths are dropped. A path must exist, except a file about to be created: a redirection or
 * `tee`/`touch` target, or a word with a folder and an extension (`src/new.js`) whose folder exists. Quotes, flags
 * and a `:line` suffix are stripped. git commands that only stage, commit or switch (GIT_BOOKKEEPING) are skipped.
 * Absolute, so the caller can keep the ones inside the repo. A script that builds its paths inside (`python3 fix.py`)
 * names nothing: doctor's note-unseen catches those edits at the end of the task.
 * @param {string} command
 * @param {string} cwd the shell's working directory
 * @returns {string[]}
 */
export function shellPaths(command, cwd) {
  const found = new Set();
  let dir = cwd;
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const words = segment.trim().split(/\s+/).map((word) => word.replace(/^['"]+|['"]+$/g, ''));
    if (isGitBookkeeping(words)) continue;
    const writes = WRITING_COMMANDS.has(words[0]);
    let afterRedirection = false;
    for (const token of segment.split(SHELL_TOKEN_SEPARATORS)) {
      if (REDIRECTION.test(token) && token.replace(REDIRECTION, '') === '') {
        afterRedirection = true;
        continue;
      }
      const created = writes || afterRedirection || REDIRECTION.test(token);
      afterRedirection = false;
      const word = token.replace(REDIRECTION, '').replace(/:\d+(:\d+)?$/, '');
      if (!word || word.startsWith('-') || /[*?<>$\\]/.test(word)) continue;
      const absolute = path.resolve(dir, word);
      if (existsSync(absolute)) found.add(absolute);
      else if ((created || word.includes('/')) && /\.\w+$/.test(word) && existsSync(path.dirname(absolute))) found.add(absolute);
    }
    // `cd x && cat y`: y is read from x
    if (words[0] === 'cd' && words[1] && existsSync(path.resolve(dir, words[1]))) dir = path.resolve(dir, words[1]);
  }
  return [...found].slice(0, MAX_SHELL_PATHS);
}

/** The file lines of a Codex patch (`*** Update File: src/x.js`, `*** Add File:`, `*** Delete File:`, `*** Move to:`). */
const PATCH_FILE_LINE = /^\*\*\* (?:Update File|Add File|Delete File|Move to): (.+)$/gm;

/**
 * The files a Codex `apply_patch` call changes, absolute. Codex sends the patch text as `tool_input.command`
 * (docs/proposals/agent-adapters.md, 2c; not verified with Codex yet).
 * @param {string} patch
 * @param {string} cwd
 * @returns {string[]}
 */
export function patchPaths(patch, cwd) {
  return [...new Set([...patch.matchAll(PATCH_FILE_LINE)].map((match) => path.resolve(cwd, match[1].trim())))];
}

/**
 * The folder a shell command runs in: the payload's `cwd`, else the tool's own `cwd`, else the project root.
 * Cursor sends both as empty strings (VERIFIED P12): empty means the root, not the hook process's folder.
 * @returns {string}
 */
function shellDir(input, realRoot) {
  const candidates = [input?.cwd, input?.tool_input?.cwd];
  return candidates.find((candidate) => typeof candidate === 'string' && candidate !== '') ?? realRoot;
}

/**
 * A tool's target as the notes see it: a repo-relative file, or a folder with a trailing slash (Grep, Glob and
 * shell commands search folders). Null outside the repo and for the repo root, which says nothing.
 * @param {string} realRoot
 * @param {string} target
 */
function repoTarget(realRoot, target) {
  // real paths on both sides: the project may be opened through a symlink (e.g. macOS /var -> /private/var)
  const realTarget = existsSync(target) ? realPath(target) : path.join(realPath(path.dirname(target)), path.basename(target));
  const file = toRepoPath(realRoot, realRoot, realTarget);
  if (file.startsWith('..') || path.isAbsolute(file)) return null;
  const folder = existsSync(realTarget) && statSync(realTarget).isDirectory();
  if (folder && (!file || file === '.')) return null;
  return folder ? { file: `${file.replace(/\/$/, '')}/`, folder } : { file, folder };
}

/**
 * The hook. Exported for tests; `input` is the parsed hook JSON.
 * @param {string} root
 * @param {any} input
 * @returns {string | null} JSON to print, or null for "nothing to add"
 */
export function hookResponse(root, input) {
  const toolName = typeof input?.tool_name === 'string' ? input.tool_name : null;
  const toolInput = input?.tool_input ?? {};
  const isShell = toolName !== null && SHELL_TOOLS.has(toolName);
  const realRoot = realPath(root);
  const command = typeof toolInput.command === 'string' ? toolInput.command : '';
  /** @type {Record<string, () => string[]>} where each kind of tool names its files */
  const targetsByKind = {
    shell: () => shellPaths(command, shellDir(input, realRoot)),
    patch: () => patchPaths(command, shellDir(input, realRoot)),
    file: () => [toolInput.file_path ?? toolInput.notebook_path ?? toolInput.path].filter((target) => typeof target === 'string' && target),
  };
  const kind = isShell ? 'shell' : toolName === 'apply_patch' ? 'patch' : 'file';
  const rawTargets = targetsByKind[kind]();
  const targets = rawTargets.map((target) => repoTarget(realRoot, target)).filter((target) => target !== null);
  if (!targets.length) return null;
  const session = typeof input.session_id === 'string' ? input.session_id : null;
  const parts = [];
  const [first] = targets;
  // the first edit of a session that measured nothing: triage before changing code (once per session)
  let reminded = false;
  if (toolName && EDIT_TOOLS.has(toolName)) {
    let untriaged = null;
    try {
      untriaged = untriagedHint(root, session, first.file);
    } catch {
      /* unreadable log: say nothing */
    }
    if (untriaged && takeUnseen(root, session, [{ file: untriaged.key }]).length) {
      parts.push(untriaged.text);
      reminded = true;
    }
  }
  // a shared file touched under a lower declared level, or with no level declared (impactHint says how often).
  // A shell command only reads: no word about impact
  if (!isShell && !reminded) {
    let hint = null;
    try {
      hint = impactHint(root, first.file, session);
    } catch {
      /* unreadable map: say nothing about impact */
    }
    if (hint && takeUnseen(root, session, [{ file: hint.key }]).length) parts.push(hint.text);
  }
  // once per note and session; a note that applies to several targets is shown for the first one
  const { notes: all } = loadNotes(root);
  // a note read directly (`Read .reins/notes/x.md`, `cat` it) counts as received: doctor's note-unseen asks no more
  const readDirectly = all.filter((note) => targets.some((target) => target.file === note.file));
  if (readDirectly.length) takeUnseen(root, session, readDirectly);
  const byNote = new Map();
  for (const target of targets) {
    for (const note of notesFor(target.folder ? `${target.file}x` : target.file, all)) if (!byNote.has(note.file)) byNote.set(note.file, { note, target: target.file });
  }
  const unseen = byNote.size ? new Set(takeUnseen(root, session, [...byNote.values()].map((entry) => entry.note)).map((note) => note.file)) : new Set();
  const fresh = [...byNote.values()].filter((entry) => unseen.has(entry.note.file));
  if (fresh.length) {
    const where = [...new Set(fresh.map((entry) => entry.target))].join(', ');
    parts.push(`Module notes for ${where} (from .reins/notes; start from them; the code wins if they disagree, and say so):\n\n${fresh.map((entry) => render(entry.target, [entry.note])).join('\n\n')}`);
  }
  if (!parts.length) return null;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: hookEventName(input.hook_event_name, 'PreToolUse'),
      additionalContext: parts.join('\n\n'),
    },
  });
}

/** @param {{ root: string, cwd: string, values: Record<string, any>, positionals: string[], out: (s: string) => void, env?: NodeJS.ProcessEnv, stdin?: string }} ctx */
export async function notes(ctx) {
  const { root, cwd, values, out } = ctx;
  if (values.hook) {
    try {
      const raw = ctx.stdin ?? (await readStdin());
      const hookRoot = ctx.env?.CLAUDE_PROJECT_DIR || root;
      const response = hookResponse(hookRoot, JSON.parse(raw));
      if (response) out(response);
    } catch {
      /* never break the agent's tool call */
    }
    return 0;
  }
  if (!ctx.positionals.length) {
    out(help);
    return 2;
  }
  if (ctx.positionals[0] === 'new') {
    if (ctx.positionals.length !== 2) {
      out(help);
      return 2;
    }
    return newNote(ctx, ctx.positionals[1]);
  }
  if (ctx.positionals[0] === 'stale' && ctx.positionals.length === 1) return staleNotes(ctx);
  const { notes: all, problems } = loadNotes(root);
  const results = ctx.positionals.map((p) => {
    const file = toRepoPath(root, cwd, p);
    return { file, notes: notesFor(file, all) };
  });
  if (values.json) {
    out(JSON.stringify({ problems, paths: results.map((r) => ({ path: r.file, notes: r.notes })) }, null, 2));
    return 0;
  }
  for (const pr of problems) out(`! warning  ${pr}`);
  // printed notes count as received by this session (doctor's note-unseen); the hooks won't repeat them
  takeUnseen(root, sessionId(ctx.env ?? process.env), results.flatMap((r) => r.notes));
  out(results.map((r) => (r.notes.length ? render(r.file, r.notes) : `No notes for ${r.file}.`)).join('\n\n'));
  return 0;
}
