// What `init` and `check --coverage` need to know about a language, without knowing any: which files are source,
// which are tests, which file is a folder's public API. Each adapter's preset declares it (`sources`, `tests`,
// `index_files`, `orphans_ignore`, `ignore_kinds`); a repo with several adapters gets the union.
import { matchesAny } from '@agentreins/core';

/**
 * @typedef {object} Conventions
 * @property {(file: string) => boolean} isSource
 * @property {(file: string) => boolean} isTest
 * @property {(file: string) => boolean} isOrphanIgnored files that nobody imports by design (config files, type declarations)
 * @property {(files: string[]) => string[]} indexFilesIn names of the file that is a folder's public API (`index.js`…),
 *   for the language(s) of these files; empty when the language has no such convention
 * @property {(files: string[]) => { kind: string, reason: string }[]} ignoredKinds edge kinds the drafted rules should
 *   ignore in this repo, with why (TypeScript's type-only imports when the repo has TypeScript files)
 */

/**
 * @param {(import('@agentreins/core/contract').Preset | null | undefined)[]} presets one per adapter; an adapter
 *   without a preset, or a preset without `sources`, counts every file as source
 * @returns {Conventions}
 */
export function conventions(presets) {
  const known = presets.filter(Boolean);
  const open = known.length < presets.length || known.length === 0 || known.some((p) => !p.sources);
  const all = (field) => known.flatMap((p) => p[field] ?? []);
  const cached = (globs, whenEmpty) => {
    const memo = new Map();
    return (file) => {
      if (!globs.length) return whenEmpty;
      if (!memo.has(file)) memo.set(file, matchesAny(file, globs));
      return memo.get(file);
    };
  };
  const inSources = cached(all('sources'), false);
  return {
    isSource: (file) => open || inSources(file),
    isTest: cached(all('tests'), false),
    isOrphanIgnored: cached(all('orphans_ignore'), false),
    indexFilesIn: (files) => [
      ...new Set(known.filter((p) => p.index_files?.length && (!p.sources || files.some((f) => matchesAny(f, p.sources)))).flatMap((p) => p.index_files)),
    ],
    ignoredKinds: (files) => {
      const out = new Map();
      for (const rule of all('ignore_kinds')) {
        const applies = files.some((f) => matchesAny(f, rule.if_files ?? ['**']) && !matchesAny(f, rule.unless_files ?? []));
        if (applies && !out.has(rule.kind)) out.set(rule.kind, { kind: rule.kind, reason: rule.reason ?? `the preset proposes ignoring \`${rule.kind}\` imports` });
      }
      return [...out.values()];
    },
  };
}

/** No conventions: every file is source, nothing is a test, no index files. */
export const ANY = conventions([]);

/**
 * The preset each loaded adapter uses for this repo: the plan's `preset` when the adapter has it, else the one
 * the adapter suggests, else its first. Null for an adapter without presets.
 * @param {{ adapter: import('@agentreins/core/contract').Adapter }[]} loaded
 * @param {string} root
 * @param {string} [chosen] `preset` of architecture.yml, or `--preset`
 * @returns {{ name: string | null, preset: import('@agentreins/core/contract').Preset | null, reason: string }[]}
 */
export function presetsOf(loaded, root, chosen) {
  return loaded.map(({ adapter }) => {
    const names = adapter.presets ?? [];
    if (!adapter.loadPreset || !names.length) return { name: null, preset: null, reason: 'the adapter has no presets' };
    const suggested = adapter.suggestPreset?.(root) ?? null;
    const name = chosen && names.includes(chosen) ? chosen : suggested ?? names[0];
    const reason = name === chosen ? 'chosen with --preset' : suggested ? 'detected' : 'default; the adapter could not detect the framework';
    return { name, preset: adapter.loadPreset(name), reason };
  });
}
