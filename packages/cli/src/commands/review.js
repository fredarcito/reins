// reins review: builds a review prompt (diff + checklist + notes) and prints it, so any agent can use it.
// It never calls an API. Executors are the extension point: today only "print" exists; a future executor
// (an API call, a local model) receives the same prompt.
import { execFileSync } from 'node:child_process';
import { notesFor } from '@agentreins/core';
import { CliError, isGitRepo } from '../context.js';
import { loadNotes, readText } from '../project.js';
import { readTemplate } from '../templates.js';
import { pickBaseRef } from './check.js';

export const CHECKLIST_FILE = '.reins/review/checklist.md';
const DEFAULT_MAX_BYTES = 200_000;

/**
 * Executors receive the prompt and do something with it. Register new ones here.
 * @type {Record<string, { description: string, run: (prompt: string, ctx: { out: (s: string) => void }) => Promise<number> | number }>}
 */
export const EXECUTORS = {
  print: { description: 'Print the prompt (default)', run: (prompt, { out }) => (out(prompt), 0) },
};

export const options = {
  base: { type: 'string' },
  executor: { type: 'string' },
  'max-bytes': { type: 'string' },
};

export const help = `Usage: reins review [--base <ref>] [--max-bytes <n>] [--executor print]

Builds a review prompt with the diff of this branch (committed and uncommitted, untracked files included),
${CHECKLIST_FILE} and the module notes of the touched paths, and prints it. Paste it into any agent, or pipe it.
It does not call any API. Executors available: ${Object.keys(EXECUTORS).join(', ')}.`;

const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * @param {{ diff: string, files: string[], checklist: string, notes: { file: string, body: string }[], base: string, maxBytes: number }} d
 */
export function buildReviewPrompt(d) {
  const truncated = Buffer.byteLength(d.diff) > d.maxBytes;
  const diff = truncated ? `${Buffer.from(d.diff).subarray(0, d.maxBytes).toString()}\n… [diff truncated at ${d.maxBytes} bytes; review the rest file by file]` : d.diff;
  return [
    '# Code review request',
    '',
    'You are reviewing a change that is not committed yet. Do not edit files and do not commit.',
    'Go through the checklist item by item, then list findings, most important first: file and line, what is wrong, why it matters, suggested fix.',
    'Finish with the checklist items that pass and anything you could not verify.',
    '',
    `## Files changed (${d.files.length}, compared to ${d.base})`,
    '',
    ...d.files.map((f) => `- ${f}`),
    '',
    '## Checklist',
    '',
    d.checklist.trim(),
    '',
    ...(d.notes.length ? ['## Module notes for these paths', '', ...d.notes.flatMap((n) => [`### ${n.file}`, '', n.body, ''])] : []),
    '## Diff',
    '',
    '```diff',
    diff.trimEnd(),
    '```',
    '',
  ].join('\n');
}

/** @param {{ root: string, values: Record<string, any>, out: (s: string) => void, env?: NodeJS.ProcessEnv }} ctx */
export async function review(ctx) {
  const { root, values, out } = ctx;
  const executor = EXECUTORS[values.executor ?? 'print'];
  if (!executor) throw new CliError(`Unknown executor "${values.executor}". Available: ${Object.keys(EXECUTORS).join(', ')}.`);
  const maxBytes = values['max-bytes'] === undefined ? DEFAULT_MAX_BYTES : Number(values['max-bytes']);
  if (!Number.isInteger(maxBytes) || maxBytes < 1000) throw new CliError('--max-bytes must be a whole number ≥ 1000.');
  if (!isGitRepo(root)) throw new CliError('reins review needs a git repository.');
  if (values.base) {
    try {
      git(root, ['rev-parse', '--verify', '--quiet', `${values.base}^{commit}`]);
    } catch {
      throw new CliError(`Base ref "${values.base}" not found.`);
    }
  }

  const baseRef = pickBaseRef(root, values.base, ctx.env);
  const base = baseRef ? git(root, ['merge-base', 'HEAD', baseRef]).trim() : 'HEAD';
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard']).split('\n').filter((f) => f && !f.startsWith('.reins/progress/') && !f.startsWith('.reins/backlog/'));
  let diff = git(root, ['diff', base]);
  for (const f of untracked) {
    try {
      diff += git(root, ['diff', '--no-index', '--', '/dev/null', f]);
    } catch (e) {
      diff += e.stdout ?? ''; // `git diff --no-index` exits 1 when files differ
    }
  }
  const files = [...new Set([...git(root, ['diff', '--name-only', base]).split('\n').filter(Boolean), ...untracked])].sort();
  if (!files.length) {
    out(`No changes compared to ${baseRef ?? 'HEAD'}: nothing to review.`);
    return 0;
  }
  const checklist = readText(root, CHECKLIST_FILE) ?? readTemplate(CHECKLIST_FILE);
  const all = loadNotes(root).notes;
  const notes = all.filter((n) => files.some((f) => notesFor(f, [n]).length));
  return executor.run(buildReviewPrompt({ diff, files, checklist, notes, base: baseRef ?? 'HEAD', maxBytes }), { out });
}
