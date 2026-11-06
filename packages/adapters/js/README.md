# @agentreins/adapter-js

The JavaScript/TypeScript adapter of [**reins**](https://www.npmjs.com/package/@agentreins/cli): it reads the import graph of Vite + React and Next projects so `reins check` can enforce your architecture.

## Install

Install it next to the CLI, in the root of your project (Node.js 22 or newer):

```bash
npm install -D @agentreins/cli @agentreins/adapter-js
# pnpm add -D @agentreins/cli @agentreins/adapter-js
# yarn add -D @agentreins/cli @agentreins/adapter-js

npx reins install
npx reins init
```

You never import this package yourself: the `reins` command finds it from `adapter: js` in `.reins/architecture.yml`.

## Supported projects

| Preset | Project | Detected from |
| --- | --- | --- |
| `vite-react` | Vite + React single page app | `vite.config.*` |
| `next-app` | Next.js, app router | `next.config.*` and an `app/` folder |
| `next-pages` | Next.js, pages router | `next.config.*` and a `pages/` folder |

Plain JS/JSX or TypeScript, with or without `src/`, single package or monorepo workspaces. `reins init` detects the preset; force one with `reins init --preset <name>`.

## What it does

- **Reads imports** with [dependency-cruiser](https://github.com/sverweij/dependency-cruiser): static, dynamic (`import()`) and type-only imports, each tagged so rules can treat them differently (`ignore_kinds` in `architecture.yml`).
- **Resolves aliases** such as `@/` from `jsconfig.json`/`tsconfig.json` (`paths`, `baseUrl`, following `extends` and `references`) and from `vite.config` `resolve.alias`. Config files are read as text, never executed.
- **Reads re-export barrels** (`components/index.js`) and reports what each importer really uses through them, so `reins init` can tell which domain owns a folder and `reins impact` can count importers behind a barrel as consumers of the real file. The import graph alone would make every importer use everything behind a barrel.
- **Warns about local imports it can't resolve**, so a broken alias never turns into a silently green check.
- **Knows framework entry points** (Next's `page`, `layout`, `route`..., Vite's `main`), so they are never reported as orphans.
- **Monorepos**: workspace packages resolve, including packages that only declare `exports` and symlinked workspaces.
- **Scans the whole repo** except `node_modules`, `.git`, `.next`, `.reins` and build output (`dist`, `build`, `out`, `coverage`, `.turbo`, `.vercel`, `.cache`, `storybook-static`); layers decide what matters.
- **Presets** give `reins init` a starting plan: layers (`app` > `features` > `components` > `shared`) and domains from `features/*` or `modules/*`, or from route folders when there are none. Route groups (`(main)`) are looked through; a folder needs more than one source file to become a domain.
- **Optional rule `next-server-client`**: a `'use client'` file must not reach, directly or through its imports, a module that imports `server-only` or `next/headers`.

## TypeScript

TypeScript projects use the `typescript` package they already have; it is an optional peer dependency. If the project has `.ts`/`.tsx` files and `typescript` is missing, `reins check` stops with an error instead of skipping those files.

## Learn more

- [Project site](https://fredarcito.github.io/reins/)
- [reins documentation](https://github.com/fredarcito/reins#readme)
- [How the JS adapter reads your project](https://github.com/fredarcito/reins#how-the-js-adapter-reads-your-project)
- [Writing an adapter for another language](https://github.com/fredarcito/reins/blob/main/docs/adapter-contract.md)

## License

MIT
