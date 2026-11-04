# Review checklist

Used by the `harness-reviewer` agent and by `harness review`. Short on purpose.

- [ ] `harness check` passes: no new violations, baseline didn't grow (or the PR says why).
- [ ] Imports respect layers and domains; other domains are used through their public API.
- [ ] The change does what the task asked, nothing more. Unrelated improvements went to the backlog.
- [ ] Shared contracts (exported functions, hooks, props) changed only on purpose, with their callers updated.
- [ ] Error and empty states are handled where the user can reach them.
- [ ] Tests cover the new behavior, or the delivery says what wasn't tested.
- [ ] Module notes updated if a durable decision or trap was found.
- [ ] No commits, no `--no-verify`, no secrets in the diff.
