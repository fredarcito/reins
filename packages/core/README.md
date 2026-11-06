# @agentreins/core

The framework-agnostic engine of [**reins**](https://www.npmjs.com/package/@agentreins/cli): architecture rules, baseline, `architecture.yml` loader, reports, impact analysis, doctor rules, module notes and the adapter contract.

## You don't install this package yourself

It comes with the CLI. To use reins in a project (Node.js 22 or newer):

```bash
npm install -D @agentreins/cli @agentreins/adapter-js
npx reins install
npx reins init
```

See [@agentreins/cli](https://www.npmjs.com/package/@agentreins/cli) for the quick start.

## What is inside

- **Rules**: `layer-direction` (a layer only imports from itself and the layers below), `domain-boundary` (code outside a domain only imports its public API), `no-cycles`, and `integrity` (changes to the plan and a growing baseline are made visible). Messages name the rule, the reason and the fix, and can be overridden per rule in `architecture.yml`.
- **Baseline**: today's violations are frozen so only new ones fail; sorted, no timestamps, clean diffs in pull requests.
- **`architecture.yml` loader**: validates the plan and reports every problem with its field path, all at once. Unknown keys are errors: a typo must not pass silently.
- **Impact analysis** (`impactOf`): the reverse of `scope`. It joins the adapter's import edges with the domains: who consumes a file (grouped by domain), which imports bypass a public API, which files a breaking change would touch. Powers `reins impact`.
- **Triage signals** (`scopeSignals`, `suggestLevel`): turn a list of files into the minimum task level (`small` / `medium` / `large`). The same thresholds power `reins scope` and the doctor's `triage-mismatch`, so what the agent announces is what the diff is measured against.
- **Reports**: text and JSON (stable `schema` number), each finding with its rule, reason and fix.
- **Doctor**: the workflow rules behind `reins doctor` (triage vs diff, notebook, module notes, `AGENTS.md` size) and the progress notebook parser and one-line-at-a-time editor behind `reins progress`.
- **Module notes**: parsing, the path → note lookup (`notesFor`), drafting from the import graph (`draftNote`), and stale ranking from git history (`rankStaleNotes`).
- **Audit backlog**: the local findings file behind `reins audit` — parsing, rendering, status changes.
- **Glob matching**: its own matcher (`*`, `**`, `?`, `{a,b}`) for layers, domains and public APIs. No glob dependency.

The core never reads source files and knows no framework: it only sees `{ from, to, kind }` import edges, computed by a language adapter. Everything framework- or language-specific (TypeScript, Vite, Next) lives in adapters such as [@agentreins/adapter-js](https://www.npmjs.com/package/@agentreins/adapter-js).

## Writing an adapter

Adapters import only the contract entry point:

```js
import { CONTRACT_VERSION, validateAdapter, validateEdges, normalizeGraph, matchesAny } from '@agentreins/core/contract';
```

The contract is versioned (`reins.contract: 1` in the adapter's `package.json`; the CLI refuses a mismatched one):

- **`detect(repoPath)`** — does this adapter apply to the repo? Return `true`, a preset name or nothing.
- **`graph(repoPath, config)`** — the import edges: `{ from, to, kind }` with kinds `static`, `dynamic` (`import()`) and `type` (type-only), plus the file list, entry points and warnings. An edge kind the rules should skip is the team's call (`ignore_kinds` per rule), not the adapter's. **Never drop edges silently**: an unresolved alias must become a warning, or `check` goes green over a hole.
- **`GraphResult` may add `barrels` and `uses`** — what each importer really uses through re-export barrels, so `init` can tell which folder owns what and `impact` can count importers behind a barrel as consumers of the real file. Optional: the rules only need `edges`.
- **`evaluate(edges, config, graph)`** — optional framework rules that need more than edges (file contents, directives; `next-server-client` is one), merged into the same report and baseline.
- **`presets`, `suggestPreset`, `loadPreset`** — optional starting plans for `reins init` (layers, where domains come from). Without them `check` works the same; `init` just asks for a hand-written `architecture.yml`.

The contract is documented in [docs/adapter-contract.md](https://github.com/fredarcito/reins/blob/main/docs/adapter-contract.md). Name a third-party adapter `reins-adapter-<language>`; the CLI finds it from `adapter: <language>` in `architecture.yml`.

## Learn more

- [Project site](https://fredarcito.github.io/reins/)
- [reins documentation](https://github.com/fredarcito/reins#readme)
- [`architecture.yml` reference](https://github.com/fredarcito/reins/blob/main/docs/architecture-yml.md)
- [Adapter contract](https://github.com/fredarcito/reins/blob/main/docs/adapter-contract.md)

## License

MIT
