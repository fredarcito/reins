---
name: arch
description: Review the architecture plan in .reins/architecture.yml against the code and propose changes with evidence, applying nothing until the person approves. Use it after reins init, when asked to review or adjust the architecture, or every few months to check that the plan still fits.
---
# Review the architecture plan

`reins check` enforces whatever `.reins/architecture.yml` says, even a bad plan, and a person decides it. Your job is to show where the plan doesn't fit the code and propose changes with evidence. **Don't edit `.reins/architecture.yml` or `.reins/baseline.json` until the person approves each change.**

1. Gather the facts (don't read the whole repo):
   - `npx reins check --coverage`: files per layer and domain, folders outside every layer, imports between layers, exceptions, baseline (`--json` if easier).
   - `.reins/init-report.md` if it exists: mixed directions, doubtful dependencies, orphans.
   - `npx reins check --verbose`: the violations frozen in the baseline.
2. Look for these, and confirm each one by opening the files involved:
   - **Layer order:** a pair with many imports going "up". Is the order wrong, or the code?
   - **Folders outside every layer:** `layer-direction` doesn't check them. Which layer do they belong to?
   - **Layers that match no file**, and globs that overlap (the first match wins).
   - **Domains:** features without a domain, a public API that doesn't exist or exposes internals, domains reaching into each other's internals.
   - **Generated code, fixtures, stories:** candidates for `ignore:`.
   - **`allow:` entries** whose reason no longer holds, and a baseline that isn't shrinking.
3. What the file accepts: `version`, `adapter`, `preset`, `ignore` (globs left out of the analysis), `layers`, `domains`, `rules`, `allow` (with a `reason`). Unknown keys are errors. Full reference: https://github.com/fredarcito/reins/blob/main/docs/architecture-yml.md
4. Rules for proposals:
   - An existing violation stays in the **baseline** by default: it is debt to fix later. Propose `allow:` only when the person says it is a decision, with their reason, never one you make up.
   - Never reorder layers, widen globs or add exceptions just to make `reins check` pass.
   - When you can't tell whether something is a mistake or a decision, ask.
5. Present the proposal as a numbered list. For each item: the change (as a YAML snippet), the evidence (files and imports), why, and its effect on the check (violations that appear or disappear). Then stop and wait for the person.
6. After approval: apply only the approved items. Run `npx reins check --update-baseline` only if the person agreed to freeze the violations the change reveals; then `npx reins check`. Tell them the pull request will show an `integrity` warning for the changed `architecture.yml`: that is expected, and the PR description should explain the change.
7. Reasons that last go where people will see them: `allow:` reasons in the file, and decisions about a module in its note (`.reins/notes/`).
