# Example: Next.js app router (TypeScript)

Minimal app used by the harness integration tests. It is never built or installed: only its imports matter.

- Aliases: `@/` → `src/`, declared in `tsconfig.json`.
- Plan: [`.harness/architecture.yml`](.harness/architecture.yml). Type-only imports are ignored by every rule (`ignore_kinds: [type]`).

Intentional violations, one per rule:

| Rule | Where |
| --- | --- |
| `layer-direction` | `src/components/OrdersLink.tsx` imports `@/features/orders` (components → features) |
| `domain-boundary` | `src/app/orders/page.tsx` imports `@/features/billing/tax` instead of the billing index |
| `no-cycles` | `src/lib/date.ts` ↔ `src/lib/time.ts` |
| `next-server-client` | `src/features/orders/OrderList.tsx` (`'use client'`) → `queries.ts` → `src/lib/db.ts` (`import 'server-only'`) |

Not violations, on purpose:

- `src/lib/time.ts`, `src/lib/db.ts` and `src/components/OrderBadge.tsx` have type-only imports that would break layers, domains or form cycles: ignored.
- `src/app/**/page.tsx`, `layout.tsx` and `route.ts` are imported by nobody, but they are Next entry points, not orphans.
- `src/lib/unused.ts` is a real orphan (reported by `harness init`, not by `check`).
