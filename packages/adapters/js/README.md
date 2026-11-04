# @agentreins/adapter-js

The JavaScript/TypeScript adapter of **reins**: it reads the import graph of Vite + React and Next projects (app and pages router), in plain JS/JSX or TypeScript, so `reins check` can enforce your architecture.

```bash
npm install -D @agentreins/cli @agentreins/adapter-js
npx reins init
```

- Resolves `@/` aliases from `jsconfig.json`/`tsconfig.json` (with `extends` and `references`) and from `vite.config`, and warns about local imports it can't resolve.
- Presets: `vite-react`, `next-app`, `next-pages`. Optional rule `next-server-client` (a `'use client'` component reaching `server-only` code).
- TypeScript projects use the `typescript` package they already have.

Documentation: https://github.com/fredarcito/reins#readme · License: MIT
