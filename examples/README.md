# examples

Minimal test projects, one per main preset. They are never installed or built: only their imports matter. Each has an intentional violation of every rule, and the adapter's integration tests (`packages/adapters/js/test/examples.test.js`) assert the exact result.

| Example | Stack | Aliases from | Violations |
| --- | --- | --- | --- |
| [`vite-react/`](vite-react/) | Vite + React, plain JS/JSX | `jsconfig.json` and `vite.config.js` | `layer-direction`, `domain-boundary`, `no-cycles` |
| [`next-app/`](next-app/) | Next app router, TypeScript | `tsconfig.json` | the three above + `next-server-client`; type-only imports ignored; one orphan |

More edge cases (Vite TS template with `tsconfig.app.json`, Next pages router, Vite alias arrays) live as fixtures in `packages/adapters/js/test/fixtures/`.
