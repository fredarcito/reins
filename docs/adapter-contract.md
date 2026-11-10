# Adapter contract (version 1)

A language adapter turns a repo into a list of edges "file A depends on file B". The core never opens a source file, so everything specific to a language or framework (imports, `@/` aliases, Next special files, `'use client'`) lives in the adapter.

```mermaid
flowchart LR
    repo["repo on disk"] --> detect{"detect(repoPath)"}
    detect -- "false" --> skip["not this adapter"]
    detect -- "true" --> graphfn["graph(repoPath, config)"]
    graphfn --> g["edges · files · entries · warnings"]
    g --> core["core rules<br/>layer-direction · domain-boundary · no-cycles"]
    g --> evaluate["evaluate(repoPath, config, graph)<br/>adapter rules, e.g. next-server-client"]
    evaluate --> core2["merged into the same report<br/>and the same baseline"]
    graphfn -. "base commit (review --map)" .-> prep["prepareCheckout(dir, repoRoot)<br/>optional"]
```

## Shape

```js
import { CONTRACT_VERSION } from '@agentreins/core/contract';

export default {
  name: 'js',                    // matches an entry of `adapters:` in architecture.yml
  contract: CONTRACT_VERSION,    // 1
  detect(repoPath) {},           // boolean (or Promise): does this adapter apply?
  graph(repoPath, config) {},    // GraphResult (or Promise)
  rules: ['next-server-client'], // optional: extra rule ids it implements
  evaluate(repoPath, config, graph) {}, // required if `rules` is not empty
  presets: ['vite-react', 'next-app', 'next-pages'], // optional, used by `reins init`
  suggestPreset(repoPath) {},    // optional: best preset name, or null
  loadPreset(name) {},           // optional: the preset, see "Presets" below
  prepareCheckout(dir, repoRoot) {}, // optional: make a checkout of another commit analyzable → { warnings }
};
```

Without `presets`/`loadPreset`, `reins init` can't draft a plan and asks the user to write `architecture.yml` by hand; `check` works the same.

In a repo with several adapters (`adapters: [js, rust]`), every adapter gets the repo root and must return only the files of its language. Rule ids must not collide with another adapter's, and `config.preset` is left out unless the preset is in the adapter's `presets`.

`validateAdapter()` from `@agentreins/core/contract` checks this shape; the CLI refuses an adapter that fails it.

## Presets: what `reins init` knows about a language

`reins init` knows no language. Everything it needs comes from the preset, a plain object.

Every adapter keeps them the same way, whatever language it reads:

| File | What |
| --- | --- |
| `presets/<name>.js` | One file per preset: `export default { description, layers, … }`. Fields shared by several presets live in one object that each preset spreads (`...CONVENTIONS`), so the file shows what it inherits and what it replaces |
| `src/presets.js` | Imports them; exports `PRESETS` (the names) and `loadPreset(name)`, which returns a copy |

The fields:

| Field | Required | What |
| --- | --- | --- |
| `description` | yes | One line |
| `layers` | yes | `[{ name, paths }]`, candidate layers top to bottom. `init` keeps the ones that exist and orders them by the imports |
| `domains_from` | yes | Globs of folders whose children become domains (`src/features/*`, `packs/*`) |
| `route_domains_from` | no | Globs of route folders that become domains when `domains_from` finds none |
| `entries` | yes | Entry-point globs: never orphans |
| `default_rules` | no | Adapter rules `init` proposes |
| `sources` | no | Globs of source files (`**/*.{rb,rake}`). Without it, every file of the graph counts as source |
| `tests` | no | Globs of test files: left out of domains, orphans and "folders outside every layer" |
| `index_files` | no | File names that are a folder's public API (`index.js`, `index.ts`); the first is proposed when a domain has none. Without it, a domain's public API is what the rest of the code already imports from it |
| `orphans_ignore` | no | Globs of files nobody imports by design (`*.config.*`, `*.d.ts`) |
| `ignore_kinds` | no | `[{ kind, if_files, unless_files?, reason }]`: the drafted rules get `ignore_kinds: [kind]` when the repo has files matching `if_files`. The JS adapter uses it for type-only imports in TypeScript repos |

| `route_segments` | no | `{ groups, params, skipped }`: how route folders are named, as regular expressions on one folder name (first capture group: the name without the marker). `groups` only group routes (`(main)`), `params` are route parameters (`[slug]`), `skipped` are never modules (`[...rest]`, `_private`). Used with `route_domains_from` |
| `source_roots` | no | Folders that only hold the code (`src`, `app`): files outside every layer are reported one level inside them (`src/store`) |

In a repo with several adapters, `init` loads one preset per adapter and joins them: layers in the adapters' order, and the union of everything else. `check --coverage` reads `sources` and `tests` the same way.

## `graph()` result

Either an array of edges, or an object:

| Field | Required | What |
| --- | --- | --- |
| `edges` | yes | `[{ from, to, kind }]`, see below |
| `files` | no | Every source file scanned. Lets `reins init` find orphans |
| `entries` | no | Files that are entry points by convention (Next `page`/`layout`/`route`, `src/main.jsx`…). Never orphans |
| `warnings` | no | Problems the user must see, e.g. imports that could not be resolved |
| `barrels` | no | Files that only re-export other modules (e.g. `components/index.js`) |
| `uses` | no | `[{ from, to }]`: what an importer really uses through barrels (`to` is the file behind the barrel). `reins init` reads it to see which domain uses a folder, and `reins impact` to count importers behind a barrel as consumers of the real file; the rules keep checking `edges` |

`normalizeGraph()` turns either form into the object form.

### Edges

| Field | Rule |
| --- | --- |
| `from` | File that imports. Relative to the repo root, `/` separators, no leading `./`, no `..` |
| `to` | Imported file, same format. Only files inside the repo: leave out `node_modules` and builtins |
| `kind` | Non-empty string. Recommended: `static`, `dynamic`, `type` |

`validateEdges()` checks this; the CLI runs it on every adapter's output.

**Never drop edges silently.** If the adapter can't read part of the repo (an unresolved alias, a missing parser), it must say so in `warnings` or throw. A missing edge means a violation `check` can't see.

## Adapter rules: `evaluate()`

Rules that need more than edges (file contents, directives) live in the adapter. `evaluate(repoPath, config, graph)` receives the parsed `architecture.yml` and the normalized graph, and returns findings with the same fields as core violations:

```js
{ rule, severity, key, from, to?, files?, message, fix }
```

- The rule ids must be listed in `rules`, so `architecture.yml` validation accepts them.
- `severity` comes from the rule's entry in `architecture.yml`; a rule that isn't listed is off.
- `key` must be stable across runs: it is what the baseline stores.

## Checkout of another commit: `prepareCheckout()`

`reins review --map` compares the branch with its merge base, so it needs the graph of **another commit**. The CLI checks that commit out in a `git worktree` (`.reins/tmp/pr-map-base-<pid>/`, removed afterwards) and calls the **already loaded** adapter's `graph()` on it (the adapter is never resolved again inside the checkout). A fresh checkout has no installed dependencies, and for a language where resolution depends on them the base graph would differ from the head's for reasons that have nothing to do with the PR.

`prepareCheckout(checkoutDir, repoRoot)` is optional. When the adapter has it, the CLI calls it after creating the worktree and before `graph()`. It makes the checkout analyzable **without installing anything**, and returns `{ warnings: string[] }` (what could not be prepared; the CLI prints them). It must not touch `repoRoot`.

The JS adapter mirrors every `node_modules` entry by entry: workspace links are recreated so they resolve to the checkout's own packages (the base version), and everything else points at the main checkout's install. With Yarn Plug'n'Play it only warns. Details and why not whole folders: [proposals/pr-map.md](proposals/pr-map.md), section 5. An adapter whose language needs nothing (no installed dependencies to resolve) omits it.

## What adapters may import from the core

Only `@agentreins/core/contract` (the core's `exports` field blocks everything else):

| Export | Use |
| --- | --- |
| `CONTRACT_VERSION` | The `contract` field |
| `matchesAny(file, globs)` | Same glob semantics as `architecture.yml` |
| `validateEdges`, `normalizeGraph`, `validateAdapter` | Self-checks in the adapter's tests |
| JSDoc types `Edge`, `GraphResult`, `Adapter`, `AdapterViolation` | Typing |

## Packaging

| Field in the adapter's `package.json` | Value |
| --- | --- |
| `name` | `@agentreins/adapter-<name>` (official) or `reins-adapter-<name>` (third party) |
| `files` | include `presets` (and `rules`, when the adapter has rules) next to `src` |
| `keywords` | include `reins-adapter` |
| `peerDependencies` | `"@agentreins/core": "^<version>"`, never a regular dependency |
| `reins.contract` | the contract version it implements, e.g. `1` |
| `exports` | expose `./package.json`, so the CLI can read `reins.contract` |

Heavy dependencies (dependency-cruiser…) belong to the adapter, never to the core or the CLI.

## Versioning

The CLI refuses an adapter whose `contract` differs from the core's `CONTRACT_VERSION`, and says which version to install. Package managers only **warn** on an incompatible peer dependency ([VERIFIED.md, P7](VERIFIED.md#p7-peerdependencies-with-pnpm--pass)), so this check is the real one.

Version 1 grew without breaking: in phase 3 `graph()` may return an object instead of an array, and `rules` + `evaluate` were added; in phase 4, `presets`, `suggestPreset` and `loadPreset`; for the PR map, `prepareCheckout`; on 2026-11-10, the preset fields that tell `init` about the language. All optional. The second adapter (`@agentreins/adapter-rails`, 2026-11-10) fit in contract 1 unchanged: constant references are edges like any other.

## A language without imports: `@agentreins/adapter-rails`

Ruby files don't import each other, so the adapter builds the edges itself: it parses every file with Prism (WebAssembly, no Ruby needed), indexes which file defines each constant, and resolves each constant reference the way Ruby does. It uses its own edge kinds next to `static`: `association` (`has_many :orders`) and `inertia` (a controller renders a page component, an edge into the frontend files that `adapter-js` owns). It has a preset and no adapter rules, and needs no `prepareCheckout`. See its [README](../packages/adapters/rails/README.md).

## Reference implementation: `@agentreins/adapter-js`

| Piece | What it does |
| --- | --- |
| `detect` | `vite.config.*` → Vite; `next.config.*` → Next (app, pages or both routers) |
| aliases | Reads `jsconfig.json`/`tsconfig.json` `paths` and `baseUrl` (following `extends` and `references`) and `resolve.alias` in `vite.config.*`, statically. No TypeScript needed for JS projects |
| `graph` | dependency-cruiser with those aliases. Edge kinds: `type` (type-only imports), `dynamic` (`import()`), `static` |
| presets | `vite-react`, `next-app`, `next-pages`, `inertia-react` (Vite inside a Rails app): starting layers for `init`, entry-point globs, and what `init` needs to know about JS (sources, tests, index files) |
| `prepareCheckout` | Mirrors `node_modules` into a worktree of another commit (pnpm workspace links stay relative); warns with Yarn PnP |
| `next-server-client` | Optional rule: a `'use client'` component must not reach a module that imports `server-only` or `next/headers` |
