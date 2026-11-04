# @agentreins/core

The framework-agnostic core of **reins**: the architecture rules (`layer-direction`, `domain-boundary`, `no-cycles`, `integrity`), the baseline, the `architecture.yml` loader, the reports, the doctor rules and the adapter contract.

**You don't install this package yourself.** It comes with the CLI:

```bash
npm install -D @agentreins/cli @agentreins/adapter-js
npx reins init
```

Language adapters import only its contract: `@agentreins/core/contract` ([adapter contract](https://github.com/fredarcito/reins/blob/main/docs/adapter-contract.md)).

Documentation: https://github.com/fredarcito/reins#readme · License: MIT
