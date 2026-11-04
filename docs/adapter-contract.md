# Adapter contract (version 1)

A language adapter turns a repo into a list of edges "file A depends on file B". The core never opens a source file, so everything specific to a language or framework (imports, `@/` aliases, Next special files) lives in the adapter.

```mermaid
flowchart LR
    repo["repo on disk"] --> detect{"detect(repoPath)"}
    detect -- "false" --> skip["not this adapter"]
    detect -- "true" --> graph["graph(repoPath, config)"]
    graph --> edges["[{ from, to, kind }]"]
    edges --> core["core rules"]
```

## Shape

```js
import { CONTRACT_VERSION } from '@harness/core/contract';

export default {
  name: 'js',                  // matches `adapter:` in architecture.yml
  contract: CONTRACT_VERSION,  // 1
  detect(repoPath) {},         // boolean (or Promise): does this adapter apply?
  graph(repoPath, config) {},  // Edge[] (or Promise)
  rules: ['next-server-client'], // optional: extra rule ids it implements
};
```

## Edges

| Field | Rule |
| --- | --- |
| `from` | File that imports. Relative to the repo root, `/` separators, no leading `./`, no `..` |
| `to` | Imported file, same format. Only files inside the repo: leave out `node_modules` and builtins |
| `kind` | Non-empty string. Recommended: `static`, `dynamic`, `type` |

`validateEdges()` from `@harness/core/contract` checks this; the CLI runs it on every adapter's output and fails with a clear message if the adapter returns something else.

## Packaging

| Field in the adapter's `package.json` | Value |
| --- | --- |
| `name` | `@harness/adapter-<name>` (official) or `harness-adapter-<name>` (third party) |
| `keywords` | include `harness-adapter` |
| `peerDependencies` | `"@harness/core": "^<version>"`, never a regular dependency |
| `harness.contract` | the contract version it implements, e.g. `1` |
| `exports` | expose `./package.json`, so the CLI can read `harness.contract` |

Rules for adapter code:

- Import from the core **only** `@harness/core/contract`. The `exports` field of the core blocks everything else.
- Heavy dependencies (dependency-cruiser…) belong to the adapter, never to the core or the CLI.

## Versioning

The CLI refuses an adapter whose `contract` differs from the core's `CONTRACT_VERSION`, and says which version to install. Package managers only **warn** on an incompatible peer dependency ([VERIFIED.md, P7](VERIFIED.md#p7-peerdependencies-with-pnpm--pass)), so this check is the real one.

The contract will probably change when a second adapter (Ruby/Packwerk) arrives; that would be contract 2.
