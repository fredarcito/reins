# @agentreins/core

The framework-agnostic engine of [**reins**](https://www.npmjs.com/package/@agentreins/cli): architecture rules, baseline, `architecture.yml` loader, reports, doctor rules, module notes and the adapter contract.

## You don't install this package yourself

It comes with the CLI. To use reins in a project (Node.js 22 or newer):

```bash
npm install -D @agentreins/cli @agentreins/adapter-js
npx reins install
npx reins init
```

See [@agentreins/cli](https://www.npmjs.com/package/@agentreins/cli) for the quick start.

## What is inside

- **Rules**: `layer-direction` (a layer only imports from itself and the layers below), `domain-boundary` (code outside a domain only imports its public API), `no-cycles`, and `integrity` (changes to the plan and a growing baseline are made visible).
- **Baseline**: today's violations are frozen so only new ones fail; sorted, no timestamps, clean diffs.
- **`architecture.yml` loader**: validates the plan and reports every problem with its field path.
- **Reports**: text and JSON (stable `schema` number), each finding with its rule, reason and fix.
- **Doctor rules and module notes**: parsing, drafting and the checks behind `reins doctor`.

The core never reads source files and knows no framework: it only sees `{ from, to, kind }` import edges, computed by a language adapter.

## Writing an adapter

Adapters import only the contract entry point:

```js
import { CONTRACT_VERSION, validateEdges, matchesAny } from '@agentreins/core/contract';
```

The contract is documented in [docs/adapter-contract.md](https://github.com/fredarcito/reins/blob/main/docs/adapter-contract.md). Name a third-party adapter `reins-adapter-<language>`; the CLI finds it from `adapter: <language>` in `architecture.yml`.

## Learn more

- [reins documentation](https://github.com/fredarcito/reins#readme)
- [`architecture.yml` reference](https://github.com/fredarcito/reins/blob/main/docs/architecture-yml.md)

## License

MIT
