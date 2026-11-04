// Drafting module notes from the import graph, shared by `reins notes new` and `reins init`.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { draftNote, matchesAny, NOTES_DIR, summarizeModule } from '@agentreins/core';

/** The group a file outside the module is shown under: its domain, or its first two folders. */
export const labeler = (domains) => (f) => {
  const d = domains.find((x) => matchesAny(f, x.paths));
  if (d) return `domain ${d.name}`;
  const dir = f.split('/').slice(0, -1).slice(0, 2).join('/');
  return dir || '(root)';
};

/**
 * Writes .reins/notes/<name>.md unless it exists (or `force`).
 * @param {string} root
 * @param {object} m
 * @param {string} m.name
 * @param {string[]} m.paths
 * @param {string[]} m.publicApi globs of the public API
 * @param {{ files: string[], edges: { from: string, to: string }[] } | null} graph null: no graph, only the public API
 * @param {string[]} files every file of the repo (used when there is no graph)
 * @param {{ name: string, paths: string[] }[]} domains for labels
 * @param {string} date
 * @param {{ force?: boolean }} [opts]
 * @returns {{ file: string, written: boolean, empty: boolean }}
 */
export function writeNoteDraft(root, m, graph, files, domains, date, opts = {}) {
  const file = `${NOTES_DIR}/${m.name}.md`;
  const all = graph ? graph.files : files;
  const empty = !all.some((f) => matchesAny(f, m.paths));
  if (existsSync(path.join(root, file)) && !opts.force) return { file, written: false, empty };
  const summary = graph ? summarizeModule({ paths: m.paths, files: graph.files, edges: graph.edges, label: labeler(domains) }) : null;
  const publicApi = all.filter((f) => matchesAny(f, m.publicApi)).sort();
  mkdirSync(path.join(root, NOTES_DIR), { recursive: true });
  writeFileSync(path.join(root, file), draftNote({ name: m.name, paths: m.paths, publicApi, summary, date }));
  return { file, written: true, empty };
}
