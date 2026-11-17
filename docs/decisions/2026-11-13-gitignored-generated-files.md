# Gitignored generated files (2026-11-13)

repvue-employer gitignores `.claude/` but commits `.reins/.generated.json`. Every clone had the manifest without the files, so `reins check` printed nine `integrity` warnings on every commit and in CI, with a fix ("commit the result") that could not be followed.

| Topic | Decision | Why |
| --- | --- | --- |
| What integrity compares | Only generated files git does not ignore (`git check-ignore`; a tracked file never counts as ignored) | Integrity is about the PR. A file that can't be committed can't be out of date in one, and a warning nobody can fix teaches people to skip the real ones |
| Who makes the ignored files | Each machine, with `reins sync --local`: only the ignored generated files, never a committed file or the manifest; silent when nothing changes; always exit 0; nothing before the repo adopted sync | reins is provider-neutral: whether a team commits a tool's adapter is the team's choice. The people never learn a command (install does it) |
| How it runs | `sync` adds `(reins sync --local \|\| exit 0)` to package.json's `prepare`, or `postinstall` with yarn, only when some generated file is ignored. Appended after `&&`, so the repo's own steps fail as before. A missing step is a normal divergence of the committed package.json | Only the repo's own install scripts run everywhere; pnpm blocks dependencies' scripts, not these. `sync`, not `install`, because existing repos upgrade through `update`, which runs `sync`. `\|\| exit 0`: `npm ci --omit=dev` has no reins |
| Still missing locally | `check` prints one plain warning pointing to `npx reins sync --local`; none in CI | Covers `--ignore-scripts`; CI never uses the files |
| Not done | Committing `.claude/` by default, or a `postinstall` in the reins package | The first is the team's call. The second is a dependency script: pnpm blocks it unless each repo approves it |
