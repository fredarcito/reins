# `architecture.yml` reference

The plan of your architecture. `harness check` enforces whatever this file says, even a bad plan: **a person decides it**, `harness init` only drafts it from what exists.

Location in a consumer repo: `.harness/architecture.yml`.

## Full example

```yaml
version: 1            # required, always 1 for now
adapter: js           # required: which language adapter computes the graph
preset: next-app      # optional: vite-react | next-app | next-pages (adapter presets)
ignore: ["src/generated/**"]   # optional: files left out of the analysis

layers:               # ordered from TOP to BOTTOM
  - { name: pages,      paths: ["src/app/**"] }
  - { name: features,   paths: ["src/features/**"] }
  - { name: components, paths: ["src/components/**"] }
  - { name: shared,     paths: ["src/hooks/**", "src/utils/**", "src/lib/**"] }

domains:
  billing: { paths: ["src/features/billing/**"], public_api: ["src/features/billing/index.js"] }
  search:  { paths: ["src/features/search/**"],  public_api: ["src/features/search/index.{js,ts}"] }

rules:
  - { id: layer-direction, severity: error, ignore_kinds: [type] }
  - { id: domain-boundary, severity: error }
  - { id: no-cycles,       severity: error }
  - { id: integrity,       severity: warn }

allow:
  - { from: "src/features/search/**", to: "src/features/billing/**",
      reason: "Search shows prices; decided 2026-11" }
```

## Keys

| Key | Required | What it is |
| --- | --- | --- |
| `version` | yes | Format version. Must be `1` |
| `adapter` | yes | Adapter name. The CLI looks for `@harness/adapter-<name>`, then `harness-adapter-<name>` |
| `preset` | no | Preset of the adapter |
| `ignore` | no | Globs of files left out of the analysis entirely: generated code, fixtures, storybook. Imports from or to them are not checked and don't produce warnings |
| `layers` | no | List of `{ name, paths }`, top layer first |
| `domains` | no | Map of name → `{ paths, public_api }` |
| `rules` | no | List of `{ id, severity, message?, fix?, ignore_kinds?, options? }` |
| `allow` | no | List of `{ from, to, reason, rule? }` |

Unknown keys are errors, so a typo (`adaptor:`) never passes silently. Every problem is reported at once, with the exact field (`layers[1].paths: …`).

## Paths and globs

Paths are relative to the repo root, with `/`. Globs support:

| Pattern | Matches |
| --- | --- |
| `*` | any characters except `/` |
| `**` | any characters including `/` (`a/**/b` also matches `a/b`) |
| `?` | one character except `/` |
| `{js,jsx}` | one of the alternatives |

Anything else is literal, so Next folders like `(shop)` or `[id]` work as written.

## How files are classified

```mermaid
flowchart TB
    f["file"] --> L{"matches a layer?<br/>(first match, top to bottom)"}
    L -- no --> out["outside every layer:<br/>layer-direction ignores it"]
    L -- yes --> layer["belongs to that layer"]
    f --> D{"matches a domain?<br/>(first match, in file order)"}
    D -- no --> nod["no domain"]
    D -- yes --> dom["belongs to that domain"]
```

If globs overlap, **the first match wins**. Put more specific layers first, or make the globs disjoint.

## Rules

| Rule | Fails when | Doesn't fail when |
| --- | --- | --- |
| `layer-direction` | a file imports a file of a layer **above** its own | same layer, a lower layer, or either file outside every layer |
| `domain-boundary` | a file imports a file of **another** domain that is not in that domain's `public_api` | same domain, or the target is the public API. Files with no domain importing a domain's internals **do** fail |
| `no-cycles` | files import each other in a loop (including a file importing itself) | edges removed by `allow` or `ignore_kinds` don't count |
| `integrity` | `architecture.yml` changed, or `baseline.json` gained entries, compared to the base branch | first adoption (the files don't exist at the base); a baseline that shrinks |

Fields of a rule entry:

| Field | Meaning |
| --- | --- |
| `severity` | `error` blocks, `warn` is reported but doesn't block, `off` disables the rule |
| `message`, `fix` | Override the texts. Placeholders: `{from}`, `{to}`; layer rule: `{from_layer}`, `{to_layer}`; domain rule: `{domain}`, `{public_api}`; cycles: `{cycle}`, `{files}` |
| `ignore_kinds` | Edge kinds the rule skips, e.g. `[type]` for type-only imports. An edge is skipped only if **all** its kinds are ignored |
| `options` | Free mapping for adapter rules (e.g. `next-server-client`) |

**Defaults.** Without a `rules:` section, the three architecture rules are `error` and `integrity` is `warn`. With a `rules:` section, unlisted rules are off, except `integrity`, which stays `warn` unless you set it to `off`.

Adapter rules (e.g. `next-server-client`) are accepted only when that adapter declares them.

## `allow`: permanent exceptions

```yaml
allow:
  - { from: "src/features/search/**", to: "src/features/billing/**", reason: "Search shows prices; decided 2026-11" }
  - { from: "src/lib/a.js", to: "src/lib/b.js", rule: no-cycles, reason: "Lazy import, broken at runtime" }
```

- `reason` is required: an exception without a reason is a violation someone forgot.
- Without `rule`, the exception applies to every rule; with `rule`, only to that one.
- `allow` is for decisions. Existing mess that should be fixed someday goes in the **baseline**, not here.

## `baseline.json`

Generated, not written by hand. It freezes the violations that exist today so `check` starts green and only fails on new ones.

```json
{
  "version": 1,
  "violations": [
    { "rule": "layer-direction", "key": "layer-direction|src/components/PriceTag.js|src/features/billing/index.js",
      "from": "src/components/PriceTag.js", "to": "src/features/billing/index.js" }
  ]
}
```

- Sorted and without timestamps, so its diff in a PR shows exactly what changed.
- A cycle's key is the sorted list of its files: if the cycle grows, it counts as a new violation.
- Entries that no longer occur are reported as "fixed"; remove them to keep the baseline shrinking.
- `integrity` warns when the baseline **grows** in a PR: freezing a new violation instead of fixing it has to be visible.
