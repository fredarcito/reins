# Example: Vite + React (plain JS/JSX)

Minimal app used by reins integration tests. It is never built or installed: only its imports matter.

- Aliases: `@/` → `src/`, declared in both `vite.config.js` and `jsconfig.json`.
- Plan: [`.reins/architecture.yml`](.reins/architecture.yml).

Intentional violations, one per rule:

| Rule | Where |
| --- | --- |
| `layer-direction` | `src/components/Button.jsx` imports `@/features/cart` (components → features) |
| `domain-boundary` | `src/pages/Home.jsx` imports `@/features/catalog/api` instead of the catalog index |
| `no-cycles` | `src/lib/format.js` ↔ `src/lib/currency.js` |
