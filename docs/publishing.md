# Publishing to npm

Three packages, published together with the same version:

| Package | What it is |
| --- | --- |
| `@agentreins/cli` | The CLI and the `reins` command |
| `@agentreins/core` | Rules, config, reports, adapter contract. A dependency of the CLI |
| `@agentreins/adapter-js` | JavaScript/TypeScript adapter. Peer of `@agentreins/core` |

Users install them with:

```bash
npm install -D @agentreins/cli @agentreins/adapter-js
```

## First time

1. The npm organization **`agentreins`** exists (created 2026-11-04, free plan). To publish, your npm user must be a member with publish rights.
2. Log in on this machine: `npm login` (2FA is required to publish).

## Every release

```bash
# 1. Bump "version" in packages/core, packages/cli and packages/adapters/js (same number) and in CHANGELOG.md
# 2. Check everything and commit
pnpm install && pnpm lint && pnpm test && pnpm self-check
git commit -am "release 0.x.y"

# 3. Rehearse: shows what would be published, uploads nothing
pnpm -r publish --dry-run --access public

# 4. Publish (asks for the 2FA code)
pnpm -r publish --access public

# 5. Tag the release commit (annotated, like every previous release) and push it
git tag -a v0.x.y -m "Release v0.x.y"
git push origin main v0.x.y
```

Tag after publishing, not before: if the publish fails and you fix something, the tag still points at what was published.

`pnpm -r publish`:

- publishes in dependency order: `@agentreins/core`, `@agentreins/adapter-js`, then `@agentreins/cli`;
- replaces every `workspace:^` with the real version;
- runs each package's `prepack`, which copies `LICENSE` (and, for the CLI, `templates/`) into the package;
- requires a clean working tree on `main`.

A published version can't be replaced: if something is wrong, publish a new patch version.

## Check it as a user

```bash
mkdir /tmp/reins-try && cd /tmp/reins-try && npm init -y
npm install -D @agentreins/cli @agentreins/adapter-js
npx reins --help
```

## Later

- Publish from GitHub Actions with `--provenance`, so npm shows that each version was built from this repository.
- Once published, the tarball instructions ([`team-install.md`](team-install.md)) become the fallback for offline or internal installs.
