# Phase 3 defaults (adapter-js)

> Partly superseded by [Presets are JS modules](2026-11-10-presets-are-js-modules.md): presets are no longer YAML.

| Topic | Decision | Why |
| --- | --- | --- |
| TypeScript | Optional peer dependency of adapter-js (dev dependency for its tests). If the repo has `.ts`/`.tsx` files and dependency-cruiser can't load `typescript`, `graph()` **throws** with the install command | Verified: without it dependency-cruiser skips TS files silently (zero edges, check green). JS/JSX projects install nothing extra |
| Aliases | Parsed by the adapter, never by executing config files: tsconfig/jsconfig `paths` + `baseUrl` (following relative `extends` and `references`), and `resolve.alias` in `vite.config.*` read as text (object and array forms, `path.resolve`, `fileURLToPath(new URL(...))`, `'/src'`). Anything it can't read becomes a warning that says to declare it in `paths` | Executing `vite.config` needs Vite installed and runs user code; JS projects must not need TypeScript |
| Unsupported `paths` | Only `prefix/*` and exact keys; other patterns produce a warning | Covers `@/*`, `~/*`, `@components/*`; rare patterns are reported, not guessed |
| Unresolved imports | Relative or alias-looking imports that don't resolve are listed in `warnings`. Bare package imports are not | An unresolved alias silently removes edges; the user must see it |
| Scanned files | Whole repo except `node_modules`, `.git`, `.next`, `.reins`, `dist`, `build`, `out`, `coverage`, `.turbo`, `.vercel`, `.cache`, `storybook-static` | Layers decide what matters; files outside every layer are ignored by the rules |
| Edge kinds | `type` (type-only, with `tsPreCompilationDeps`), `dynamic` (`import()`), `static` (everything else) | Lets `ignore_kinds: [type]` work |
| Presets | YAML: `layers` (starting point for `init`), `domains_from` (folders whose children become domains), `route_domains_from` (route folders, used only when `domains_from` finds none), `entries` (globs) | Presets are data, not code |
| Entries | Next special files (`page`, `layout`, `route`, `template`, `loading`, `error`, `not-found`, metadata files, `middleware`…), every file under `pages/`, `src/main.*`, config files, tests and stories | Design: Next special files are entries, not orphans |
| `next-server-client` | Optional (off unless listed). A `'use client'` file (directive as first statement) must not reach, through runtime imports, a module that imports `server-only` or `next/headers`. Reports the nearest one per path, with the chain | Everything a client component imports ships to the browser. `'use server'` files are allowed: client components may import server actions |
| Contract growth | `graph()` may return `{ edges, files, entries, warnings }`; adapters may declare `rules` and implement `evaluate(repoPath, config, graph)`. Still contract 1 (all optional) | `init` needs files/entries; adapter rules need file contents |
| Contract surface | `matchesAny` re-exported from `@agentreins/core/contract` | Adapters can only import the contract; avoids a second glob implementation |
| Test runner | Each package runs `node --test "test/**/*.test.js"` | Without arguments node also runs fixture files under `test/` |
