# Publishing to npm

Three packages, published together with the same version:

| Package | What it is |
| --- | --- |
| `reins` | The CLI and the `reins` command. Unscoped on purpose: `npx reins` can only ever find this package |
| `@reins/core` | Rules, config, reports, adapter contract. A dependency of `reins` |
| `@reins/adapter-js` | JavaScript/TypeScript adapter. Peer of `@reins/core` |

Users install them with:

```bash
npm install -D reins @reins/adapter-js
```

## First time

1. On npmjs.com, create the organization **`reins`** (free for public packages). Creating it is also how you find out whether the name is free; if it isn't, run `pnpm rename-scope @other` first (the CLI stays `reins`).
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
```

`pnpm -r publish`:

- publishes in dependency order: `@reins/core`, `@reins/adapter-js`, then `reins`;
- replaces every `workspace:^` with the real version;
- runs each package's `prepack`, which copies `LICENSE` (and, for the CLI, `templates/`) into the package;
- requires a clean working tree on `main`.

A published version can't be replaced: if something is wrong, publish a new patch version.

## Check it as a user

```bash
mkdir /tmp/reins-try && cd /tmp/reins-try && npm init -y
npm install -D reins @reins/adapter-js
npx reins --help
```

## Later

- Publish from GitHub Actions with `--provenance`, so npm shows that each version was built from this repository.
- Once published, the tarball instructions ([`team-install.md`](team-install.md)) become the fallback for offline or internal installs.
