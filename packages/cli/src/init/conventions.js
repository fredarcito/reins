// What `init` and `check --coverage` need to know about a language, without knowing any: which files are source,
// which are tests, which file is a folder's public API. Each adapter's preset declares it (`sources`, `tests`,
// `index_files`, `orphans_ignore`, `ignore_kinds`, `route_segments`, `source_roots`); a repo with several adapters
// gets the union.
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
 * @property {{ isGroup: (segment: string) => boolean, isParam: (segment: string) => boolean,
 *   isSkipped: (segment: string) => boolean, nameOf: (segment: string) => string }} routes
 *   how route folders are named (the preset's `route_segments`): a group only groups routes and is not part of the
 *   route path, a param is a route parameter, a skipped folder is never a module; `nameOf` drops the markers
 *   (`(search)` -> `search`). A language without such conventions has none of them
 * @property {(file: string) => string} folderOf the folder a file is grouped under when it is in no layer: one
 *   level inside a source root (`src/store`, `app/services`), else its first folder
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
  const segments = (field) => known.flatMap((p) => p.route_segments?.[field] ?? []).map((source) => new RegExp(source));
  const [groups, params, skipped] = [segments('groups'), segments('params'), segments('skipped')];
  const roots = [...new Set(all('source_roots'))].sort((a, b) => b.length - a.length); // the deepest root wins
  return {
    isSource: (file) => open || inSources(file),
    isTest: cached(all('tests'), false),
    isOrphanIgnored: cached(all('orphans_ignore'), false),
    indexFilesIn: (files) => [
      ...new Set(known.filter((p) => p.index_files?.length && (!p.sources || files.some((f) => matchesAny(f, p.sources)))).flatMap((p) => p.index_files)),
    ],
    routes: {
      isGroup: (segment) => groups.some((r) => r.test(segment)),
      isParam: (segment) => params.some((r) => r.test(segment)),
      isSkipped: (segment) => skipped.some((r) => r.test(segment)),
      nameOf: (segment) => {
        for (const r of [...groups, ...params]) {
          const m = r.exec(segment);
          if (m) return m[1] ?? segment;
        }
        return segment;
      },
    },
    folderOf: (file) => {
      const root = roots.find((r) => file.startsWith(`${r}/`) && file.slice(r.length + 1).includes('/'));
      return root ? `${root}/${file.slice(root.length + 1).split('/')[0]}` : file.split('/')[0];
    },
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
