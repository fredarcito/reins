// reins notes <path…>: prints the module notes that apply to a path.
// reins notes --hook: the same, as a Claude Code PreToolUse hook (JSON in on stdin, JSON out), at most once
// per note and session. It never blocks the agent: any problem means "no note".
import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { notesFor, NOTES_DIR } from '@agentreins/core';
import { CliError, toRepoPath } from '../context.js';
import { takeUnseen } from '../notes-seen.js';
import { writeNoteDraft } from '../notes-draft.js';
import { loadNotes, readDomains } from '../project.js';
import { analyze } from './check.js';

export { SEEN_FILE } from '../notes-seen.js';

export const options = {
  hook: { type: 'boolean' },
  json: { type: 'boolean' },
  paths: { type: 'string' },
  name: { type: 'string' },
  force: { type: 'boolean' },
};
export const positionals = true;

export const help = `Usage: reins notes <path…> [--json]
       reins notes new <domain|folder> [--name <name>] [--paths <glob,…>] [--force]
       reins notes --hook

Prints the module notes (.reins/notes/*.md) whose "paths" match each path.

new     Drafts .reins/notes/<name>.md for a domain of architecture.yml or a folder: the import graph fills in
        the public API, the most imported files, who uses the module and what it depends on; the rest are TODO
        lines for the agent or a person to fill in. --name sets the file name (default: the domain or the
        folder name), --paths overrides the globs, --force overwrites.
--hook  For the Claude Code PreToolUse hook that reins sync installs: reads the tool call from stdin and
        returns the notes as additional context, once per note and session.`;

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage']);

/** Every file under a repo folder (repo-relative), skipping build output and dependencies. */
function walk(root, rel = '') {
  const out = [];
  for (const name of readdirSync(path.join(root, rel)).sort()) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(path.join(root, r)).isDirectory()) out.push(...walk(root, r));
    else out.push(r);
  }
  return out;
}

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
    name = path.basename(rel);
    paths = [`${rel}/**`];
    api = [`${rel}/index.{js,jsx,ts,tsx}`];
  }
  if (values.paths) paths = values.paths.split(',').map((p) => p.trim()).filter(Boolean);
  if (values.name) {
    if (!/^[\w.-]+$/.test(values.name)) throw new CliError(`--name must be a plain file name (letters, digits, ".", "_", "-"), got "${values.name}".`);
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
  out(`Drafted ${file}. Run \`reins sync\` to add it to the AGENTS.md index, then ask your agent to fill in its TODO lines (in Claude Code: /reins-fill-notes).`);
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

/**
 * The hook. Exported for tests; `input` is the parsed hook JSON.
 * @param {string} root
 * @param {any} input
 * @returns {string | null} JSON to print, or null for "nothing to add"
 */
export function hookResponse(root, input) {
  const target = input?.tool_input?.file_path ?? input?.tool_input?.notebook_path ?? input?.tool_input?.path;
  if (typeof target !== 'string' || !target) return null;
  // real paths on both sides: the project may be opened through a symlink (e.g. macOS /var -> /private/var)
  const real = (p) => {
    try {
      return realpathSync(p);
    } catch {
      return path.resolve(p); // a file about to be created doesn't exist yet
    }
  };
  const realRoot = real(root);
  const realTarget = existsSync(target) ? real(target) : path.join(real(path.dirname(target)), path.basename(target));
  const file = toRepoPath(realRoot, realRoot, realTarget);
  if (file.startsWith('..') || path.isAbsolute(file)) return null;
  const notes = notesFor(file, loadNotes(root).notes);
  if (!notes.length) return null;

  // once per note and session
  const unseen = takeUnseen(root, typeof input.session_id === 'string' ? input.session_id : null, notes);
  if (!unseen.length) return null;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name ?? 'PreToolUse',
      additionalContext: `Module notes for ${file} (from .reins/notes; follow them):\n\n${render(file, unseen)}`,
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
  out(results.map((r) => (r.notes.length ? render(r.file, r.notes) : `No notes for ${r.file}.`)).join('\n\n'));
  return 0;
}
