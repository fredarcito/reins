# Contributing

Thanks for helping! This repo is small on purpose: a core that knows no framework, thin adapters, and markdown content.

## Setup

```bash
pnpm install          # Node >= 22
pnpm lint             # syntax, import boundaries, AGENTS.md rules, mermaid diagrams, package metadata
pnpm test             # every package + repo scripts (node:test)
pnpm self-check       # this repo's own architecture: dependency-cruiser alone + harness check from source
```

Run all three before opening a PR; CI runs them on Node 22 and 24.

## Ground rules

- **Dependency direction:** `cli` → `adapters` → `core`. `core` never imports the CLI or an adapter, and knows no framework (no `if (next)` in the core). Adapters import the core only through `@harness/core/contract`. `pnpm self-check` enforces it.
- **Plain JavaScript with JSDoc types**, ESM, no build step. Tests use `node:test` and live in each package's `test/` (`*.test.js`; anything else there is a fixture).
- **Every new dependency** is justified in [`docs/DECISIONS.md`](docs/DECISIONS.md). Heavy ones belong to an adapter, never to the core or the CLI.
- **Everything in English**: code, comments, docs, templates, CLI messages.
- **Error messages say the rule, why, and how to fix it**: agents read them.
- **Anything assumed about external tools** (Claude Code hooks, permissions, package managers) that you haven't tested goes in [`docs/VERIFIED.md`](docs/VERIFIED.md) as unverified. Add a script to `scripts/verify/` when you test it.
- **Stable vs. experimental:** a piece is stable when a tool enforces it and it has tests; otherwise experimental. Keep [`docs/STATUS.md`](docs/STATUS.md) and the README table in sync.
- **The README is the team's documentation**: update it (with diagrams) when you change what exists. Mermaid labels can't contain HTML entities, quotes, `<`, `>` or `|` (GitHub fails to render them; `pnpm lint` checks).

## Agents working on this repo

[`AGENTS.md`](AGENTS.md) applies to humans too: agents never commit, push, open PRs or publish, and never use `--no-verify`. Changes stay uncommitted for a person to review.

## Adding a language adapter

Read [`docs/adapter-contract.md`](docs/adapter-contract.md). An adapter is a package (`@harness/adapter-<name>` in this repo, or `harness-adapter-<name>` in yours) with `harness.contract` in its `package.json`, `@harness/core` as a peer dependency, and `detect` + `graph`. Ship an example repo with one intentional violation per rule and integration tests against it, like `examples/` and `packages/adapters/js/test/examples.test.js`.

## Releasing (maintainers)

Not published to npm yet. Bump the versions in the three packages, update [`CHANGELOG.md`](CHANGELOG.md), `pnpm pack:all`, and share the tarballs ([`docs/team-install.md`](docs/team-install.md)). The npm scope `@harness` is a placeholder: `pnpm rename-scope @new-scope` changes it everywhere.
