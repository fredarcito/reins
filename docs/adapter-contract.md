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
```

## Shape

```js
import { CONTRACT_VERSION } from '@reins/core/contract';

export default {
  name: 'js',                    // matches `adapter:` in architecture.yml
  contract: CONTRACT_VERSION,    // 1
  detect(repoPath) {},           // boolean (or Promise): does this adapter apply?
  graph(repoPath, config) {},    // GraphResult (or Promise)
  rules: ['next-server-client'], // optional: extra rule ids it implements
  evaluate(repoPath, config, graph) {}, // required if `rules` is not empty
  presets: ['vite-react', 'next-app', 'next-pages'], // optional, used by `reins init`
  suggestPreset(repoPath) {},    // optional: best preset name, or null
  loadPreset(name) {},           // optional: { description, layers, domains_from, entries, default_rules? }
};
```

Without `presets`/`loadPreset`, `reins init` can't draft a plan and asks the user to write `architecture.yml` by hand; `check` works the same.

`validateAdapter()` from `@reins/core/contract` checks this shape; the CLI refuses an adapter that fails it.

## `graph()` result

Either an array of edges, or an object:

| Field | Required | What |
| --- | --- | --- |
| `edges` | yes | `[{ from, to, kind }]`, see below |
| `files` | no | Every source file scanned. Lets `reins init` find orphans |
| `entries` | no | Files that are entry points by convention (Next `page`/`layout`/`route`, `src/main.jsx`…). Never orphans |
| `warnings` | no | Problems the user must see, e.g. imports that could not be resolved |

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

## What adapters may import from the core

Only `@reins/core/contract` (the core's `exports` field blocks everything else):

| Export | Use |
| --- | --- |
| `CONTRACT_VERSION` | The `contract` field |
| `matchesAny(file, globs)` | Same glob semantics as `architecture.yml` |
| `validateEdges`, `normalizeGraph`, `validateAdapter` | Self-checks in the adapter's tests |
| JSDoc types `Edge`, `GraphResult`, `Adapter`, `AdapterViolation` | Typing |

## Packaging

| Field in the adapter's `package.json` | Value |
| --- | --- |
| `name` | `@reins/adapter-<name>` (official) or `reins-adapter-<name>` (third party) |
| `keywords` | include `reins-adapter` |
| `peerDependencies` | `"@reins/core": "^<version>"`, never a regular dependency |
| `reins.contract` | the contract version it implements, e.g. `1` |
| `exports` | expose `./package.json`, so the CLI can read `reins.contract` |

Heavy dependencies (dependency-cruiser…) belong to the adapter, never to the core or the CLI.

## Versioning

The CLI refuses an adapter whose `contract` differs from the core's `CONTRACT_VERSION`, and says which version to install. Package managers only **warn** on an incompatible peer dependency ([VERIFIED.md, P7](VERIFIED.md#p7-peerdependencies-with-pnpm--pass)), so this check is the real one.

Version 1 grew without breaking: in phase 3 `graph()` may return an object instead of an array, and `rules` + `evaluate` were added; in phase 4, `presets`, `suggestPreset` and `loadPreset`. All optional. The contract will probably change for real when a second adapter (Ruby/Packwerk) arrives; that would be contract 2.

## Reference implementation: `@reins/adapter-js`

| Piece | What it does |
| --- | --- |
| `detect` | `vite.config.*` → Vite; `next.config.*` → Next (app, pages or both routers) |
| aliases | Reads `jsconfig.json`/`tsconfig.json` `paths` and `baseUrl` (following `extends` and `references`) and `resolve.alias` in `vite.config.*`, statically. No TypeScript needed for JS projects |
| `graph` | dependency-cruiser with those aliases. Edge kinds: `type` (type-only imports), `dynamic` (`import()`), `static` |
| presets | `vite-react`, `next-app`, `next-pages`: starting layers for `init` and entry-point globs |
| `next-server-client` | Optional rule: a `'use client'` component must not reach a module that imports `server-only` or `next/headers` |
