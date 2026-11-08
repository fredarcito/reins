// reins notes <path…>: prints the module notes that apply to a path.
// reins notes --hook: the same, as a Claude Code PreToolUse hook (JSON in on stdin, JSON out), at most once
// per note and session. It never blocks the agent: any problem means "no note".
import { existsSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { matchesAny, notesFor, NOTES_DIR, rankStaleNotes } from '@agentreins/core';
import { CliError, isGitRepo, toRepoPath } from '../context.js';
import { impactHint } from '../impact-map.js';
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
--hook  For the Claude Code PreToolUse hook that reins sync installs: reads the tool call from stdin and
        returns the notes as additional context, once per note and session.`;

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
  const session = typeof input.session_id === 'string' ? input.session_id : null;
  const parts = [];
  // a shared file touched under a lower declared level, or with no level declared (impactHint says how often)
  let hint = null;
  try {
    hint = impactHint(root, file);
  } catch {
    /* unreadable map: say nothing about impact */
  }
  if (hint && takeUnseen(root, session, [{ file: hint.key }]).length) parts.push(hint.text);
  const notes = notesFor(file, loadNotes(root).notes);
  // once per note and session
  const unseen = notes.length ? takeUnseen(root, session, notes) : [];
  if (unseen.length) parts.push(`Module notes for ${file} (from .reins/notes; follow them):\n\n${render(file, unseen)}`);
  if (!parts.length) return null;
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: input.hook_event_name ?? 'PreToolUse',
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
  out(results.map((r) => (r.notes.length ? render(r.file, r.notes) : `No notes for ${r.file}.`)).join('\n\n'));
  return 0;
}
