// domain-uncovered: a task added code to a folder no domain covers, while the folders next to it are each a domain
// (`src/components/pages/*` everywhere but the new one). No rule checks that code and `scope` measured it as
// domain-less; the agent that made the folder knows what it is, so now is when adding it to a domain is cheap.
// Origin: DEV-8914 (repvue-employer): `components/pages/gtmIntelligence/` (14 files) stayed out of every domain, and
// its documentation went into a note whose paths never covered it.
import { matchesAny } from '../glob.js';
import { isReinsFile } from './triage.js';

// share of the sibling folders that must be domain folders: "the other folders here are domains"
const SIBLING_SHARE = 0.75;
const MIN_DOMAIN_SIBLINGS = 2;

const parentOf = (folder) => (folder.includes('/') ? folder.slice(0, folder.lastIndexOf('/')) : '');
const baseName = (folder) => folder.slice(folder.lastIndexOf('/') + 1);
/** `a/b/c.js` → [`a`, `a/b`] */
const foldersOf = (file) => {
  const parts = file.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
};

/**
 * Folders the changed files put code in that no domain covers, while their siblings are domain folders.
 * A folder with any file in a domain is never reported (a gap inside a domain is another problem), and neither is a
 * folder whose siblings are mostly not domains (shared code next to shared code).
 * @param {object} input
 * @param {string[]} input.changedFiles repo-relative
 * @param {string[]} input.repoFiles every file of the repo (tracked and untracked)
 * @param {{ name: string, paths: string[] }[]} input.domains
 * @param {{ file: string, body: string }[]} [input.notes] module notes: the ones that mention a folder are named
 * @param {string[]} [input.notCounted] globs of files that say nothing about the task (docs, tests)
 * @returns {{ folder: string, files: number, changed: number, parent: string, notes: string[] }[]} sorted by folder
 */
export function uncoveredFolders({ changedFiles, repoFiles, domains, notes = [], notCounted = [] }) {
  const code = changedFiles.filter((f) => !isReinsFile(f) && !(notCounted.length && matchesAny(f, notCounted)));
  const inDomain = (f) => domains.some((d) => matchesAny(f, d.paths));
  const candidates = code.filter((f) => !inDomain(f));
  if (!candidates.length || !domains.length) return [];

  /** @type {Map<string, { total: number, covered: number }>} */
  const size = new Map();
  /** @type {Map<string, Set<string>>} */
  const children = new Map();
  for (const f of new Set([...repoFiles, ...code])) {
    const covered = inDomain(f);
    for (const folder of foldersOf(f)) {
      const s = size.get(folder) ?? { total: 0, covered: 0 };
      s.total += 1;
      if (covered) s.covered += 1;
      size.set(folder, s);
      const parent = parentOf(folder);
      if (!children.has(parent)) children.set(parent, new Set());
      /** @type {Set<string>} */ (children.get(parent)).add(folder);
    }
  }
  const isDomainFolder = (folder) => {
    const s = size.get(folder);
    return Boolean(s && s.total === s.covered);
  };
  const outsideDomains = (folder) => (size.get(folder)?.covered ?? 0) === 0;
  const looksLikeDomain = (folder) => {
    const siblings = [...(children.get(parentOf(folder)) ?? [])].filter((s) => s !== folder);
    const domainSiblings = siblings.filter(isDomainFolder).length;
    return domainSiblings >= MIN_DOMAIN_SIBLINGS && domainSiblings >= siblings.length * SIBLING_SHARE;
  };

  /** @type {Map<string, number>} */
  const found = new Map();
  for (const f of candidates) {
    // top-down: the folder at the level of the domain folders, not one of its subfolders
    const folder = foldersOf(f).find((x) => outsideDomains(x) && looksLikeDomain(x));
    if (folder) found.set(folder, (found.get(folder) ?? 0) + 1);
  }
  return [...found].sort(([a], [b]) => (a < b ? -1 : 1)).map(([folder, changed]) => {
    const parent = parentOf(folder);
    const mention = `${parent ? `${baseName(parent)}/` : ''}${baseName(folder)}`;
    return {
      folder,
      files: size.get(folder)?.total ?? changed,
      changed,
      parent,
      notes: notes.filter((n) => n.body.includes(mention) || n.body.includes(`\`${baseName(folder)}\``)).map((n) => n.file),
    };
  });
}

/** One line for scope and the doctor's message. */
export function describeUncovered(u) {
  const where = u.parent ? `, unlike the other folders of ${u.parent}/` : '';
  const named = u.notes.length ? ` ${u.notes.join(', ')} describe${u.notes.length > 1 ? '' : 's'} it, but no domain covers it.` : '';
  return `${u.folder}/ (${u.files} file${u.files === 1 ? '' : 's'}, ${u.changed} changed) is in no domain${where}.${named}`;
}

export const UNCOVERED_FIX = 'Add it to a domain in .reins/architecture.yml, or create one for it (the reins-arch skill), and give it a note or add it to the paths of the note that describes it.';

/**
 * The doctor's domain-uncovered findings.
 * @param {Parameters<typeof uncoveredFolders>[0]} input
 */
export function checkUncoveredFolders(input) {
  return uncoveredFolders(input).map((u) => ({
    rule: 'domain-uncovered', severity: /** @type {const} */ ('warn'), key: `domain-uncovered|${u.folder}`, from: u.folder,
    message: describeUncovered(u), fix: UNCOVERED_FIX,
  }));
}
