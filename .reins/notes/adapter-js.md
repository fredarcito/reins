---
paths: ["packages/adapters/js/**"]
---
# adapter-js

## Purpose
Language adapter for JavaScript/TypeScript repos (Vite + React, Next app and pages router): turns the repo into dependency edges for the core, and provides presets and the `next-server-client` rule. Loaded by the CLI at runtime from the consumer repo.

## Map
- Files: 11. Used by: nothing outside the module (the CLI resolves it dynamically). Depends on: domain core, only through `@agentreins/core/contract`
- `src/index.js`: the adapter object (`name: 'js'`, `contract`, `detect`, `graph`, `rules`, `evaluate`, presets).
- `src/graph.js`: runs dependency-cruiser, filters to local files, classifies edge kinds, computes entries, collects warnings.
- `src/aliases.js`: reads aliases from tsconfig/jsconfig `paths`/`baseUrl` (following `extends`/`references`) and `vite.config.*` `resolve.alias`, as text.
- `src/detect.js`: Vite vs Next (and which router) from config files and folders; suggests a preset.
- `src/presets.js` + `presets/*.yml`: `vite-react`, `next-app`, `next-pages` (layers, `domains_from`, `route_domains_from`, `entries`, `default_rules`).
- `rules/next-server-client.js`: a `'use client'` file must not reach a module importing `server-only` or `next/headers`.

## How it works
`graph(repoPath, config)` resolves the real root, refuses to run if there are TS files but no `typescript`, reads aliases, and calls dependency-cruiser with them. It keeps edges between local, non-ignored files, tags each as `static`/`dynamic`/`type`, warns about local-looking imports that did not resolve, and marks entry files from the preset (configured or detected). `evaluate` runs `next-server-client` on the normalized graph when it is enabled in `architecture.yml`.

## Decisions
- 2026-11-04: config files are never executed; aliases are parsed as text. Executing `vite.config` would need Vite and run user code. Anything unreadable becomes a warning pointing to `paths`.
- 2026-11-04: `typescript` is an optional peer; `graph()` throws when TS files exist and it is missing, because dependency-cruiser would skip them silently (zero edges, green check).
- 2026-11-04: `exportsFields`/`conditionNames` passed to dependency-cruiser and the root is a real path, so `exports`-only workspace packages and symlinked workspaces keep their edges (bug found in phase 9).
- 2026-11-04: presets are YAML data, not code. `next-server-client` is opt-in, and `'use server'` files are allowed targets.

## Traps
- Silent edge loss is the main risk: an unresolved alias or missing TS just removes edges and `check` passes. Keep the loud failure and the unresolved-import warning.
- Import nothing from core except `@agentreins/core/contract`.
- Only `prefix/*` and exact `paths` keys are supported; others warn. Vite `/src` means `<root>/src`.
- Edge paths must be repo-relative POSIX (`validateEdges` rejects anything else).
- Tests run `node --test "test/**/*.test.js"` explicitly so fixtures under `test/fixtures/` are not executed.
