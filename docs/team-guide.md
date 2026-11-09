# Team guide: working in a repo that uses reins

For everyone on a team whose repo already has reins: what it is, what is in the repo, and how a task goes from start to PR. You don't need to learn its commands: you talk to your agent (Claude Code, Codex, Cursor…), and the agent runs reins.

The person who adopts reins can paste this guide as the description of the adoption PR. Replace the examples (layers, areas, numbers) with the repo's own, from `.reins/architecture.yml` and `.reins/init-report.md`.

## What is reins?

A dev tool ([npm](https://www.npmjs.com/package/@agentreins/cli)) that does two things:

1. **It protects the architecture.** It blocks commits that break how the app is organized. Example: a helper in `src/lib` importing from a feature in `src/features`.
2. **It gives coding agents memory.** Agents forget everything between sessions. reins keeps short notes per area and a notebook per task, and the agent reads them before working.

## Setup (once)

```bash
git pull && npm install      # or pnpm install / yarn
```

The pre-commit hook and the CLI come with the dev dependencies.

## What's in the repo

Almost all of it is config, not app code:

| File | What it is |
| --- | --- |
| `.reins/architecture.yml` | **The plan**: layers, areas and rules (see below) |
| `.reins/baseline.json` | The problems that already existed when reins arrived. They're tolerated; only new ones fail |
| `.reins/notes/*.md` | One note per area (see Notes) |
| `.reins/agents/`, `.reins/skills/`, `.reins/review/` | Empty on purpose: the place for the team's own agents, skills and review checklist |
| `.reins/core/` | reins' own files. **Don't edit them**: every update rewrites them |
| `AGENTS.md`, `.claude/` | Instructions, skills, agents and hooks for coding agents |
| The pre-commit hook, `.github/workflows/reins.yml` | The check on commit and on each PR |

## The plan: how the app is organized

"The plan" is `.reins/architecture.yml`: a short file that says how the code is supposed to be organized. reins checks every commit and PR against it. It has three parts.

**1. Layers: who can import whom.** Imports only go down. For example:

| Layer | Folders | Can import |
| --- | --- | --- |
| app | `src/pages/**`, `src/App.jsx` | features, components, shared |
| features | `src/features/**` | components, shared |
| components | `src/components/**` | shared |
| shared | `src/lib/**`, `src/hooks/**` | only shared |

Example of what fails: a hook in `src/hooks` importing a page from `src/pages`.

**2. Areas (domains): each feature keeps its internals to itself.** An area groups the folders of one feature, for example **cart** = `src/features/cart/**`. Each area has a **public entry**, such as `src/features/cart/index.js`. Other areas use cart only through that file, never its internals.

Example of what fails: `catalog` importing `src/features/cart/cartStore.js` directly.

**3. Rules.**

- **Layers:** imports only go down.
- **Areas:** other areas only through the public entry.
- **No cycles:** no files importing each other in a loop.
- **Plan changes:** a PR that edits the plan, or adds problems to the baseline, gets an `integrity` warning so reviewers notice.

Problems that already existed are frozen in `.reins/baseline.json`. They don't fail; only new ones do.

**What the plan isn't:** it doesn't judge code style, naming or logic. It only looks at **who imports whom**.

**Changing it** (`/reins-arch`). The plan describes today's app, and it changes when the app does. `/reins-arch` compares the plan with the code and proposes changes with evidence. It applies **only what you approve**. Examples:

- `/reins-arch`: check that the plan still fits. Worth doing every few months.
- *"/reins-arch add a domain for the new billing pages and draft its note"*.
- *"/reins-arch `src/components/checkout` belongs to cart"*.

**When a rule doesn't fit.** Sometimes an import that breaks the plan is the right call. Don't skip the check; ask for an exception with its reason, for example *"allow catalog to import CartBadge from cart; it's shared until we move it"*. Plan changes go in a PR like any code, and the `integrity` warning is intended.

## Skills and agents

- **A skill** is a ready-made workflow. In Claude Code you start it with a slash. Example: `/reins-done` closes the task step by step. With other agents, say it in words: *"close the task"*.
- **An agent** is a helper with one job that your main agent launches for you. reins ships two:

| Agent | What it does | When | How |
| --- | --- | --- | --- |
| **reviewer** | Reads your uncommitted changes like a teammate and lists problems. Only reads | Before committing medium or large tasks | Usually on its own at the end of large tasks; otherwise *"review my changes"* |
| **explorer** | Maps the code involved (files, areas, notes, risks) before a big change. Only reads | Before the plan of a large task | The agent launches it; you don't need to |

**Need another agent?** Use `/reins-agent`. Example: *"/reins-agent create a tester that writes missing tests for the files I changed"*.

## Notes

A note is a short Markdown file about one area, for example `.reins/notes/cart.md`. It has:

- **Purpose**: what the area does.
- **Map**: its key files.
- **How it works**: the main flow.
- **Decisions**: what was decided, and why.
- **Traps**: what looks wrong but is intentional.

The `paths:` line at the top says which files it covers. When the agent opens one of those files, the note reaches it first (automatic in Claude Code; other agents find it through `AGENTS.md`). Notes are also a good intro for people.

| You want to | Example |
| --- | --- |
| Fill in a note's empty parts from the code | `/reins-notes cart` |
| Update notes that fell behind the code | `/reins-notes review` |
| Add something you know | *"add to the cart note that totals are integer cents on purpose"* |
| Edit by hand | Edit the `.md`, then run `npx reins sync` |

Commit notes like code.

## Branches and tasks

**One branch per task** (per ticket), as usual. reins doesn't force it, but it works best that way:

- the task's notebook lives with its branch;
- the size check compares against where the branch started;
- the PR map shows only that change;
- old notebooks are cleaned up when the branch is gone.

Several related tasks on one branch are fine too. Each one gets its own notebook.

**Notebook.** For medium and large tasks the agent keeps one per task: goal, steps, next step. It's local (`.reins/progress/<branch>/`), not committed.

**Resuming:**

- **Same session:** after the conversation gets compacted or you run `/clear`, Claude Code gets its task back on its own.
- **New session on the same branch:** nothing resumes by itself. The agent sees the list of open tasks on that branch. Tell it which one: *"continue the coupon task"*.
- **Two sessions in parallel** on one branch: give each its part (*"you do the CSS, the other session is on the JS"*). Each keeps its own notebook. A session never takes over another's task unless you ask.

## How a task works

**1. Start.** Create the branch, then ask your agent for the task, for example *"add a coupon field to the cart"*. First it says the size:

- **small**: 1–3 files. It just does it.
- **medium**: one area, several files. It reads the note first.
- **large**: several areas, a feature or a refactor. The explorer maps the code, and the agent shows a plan and **waits for your OK**.

To force a size, start your message with `[quick]` or `[deep]`. Example: *"[quick] fix the typo in the cart header"*.

**2. Work.** The agent reads the notes of what it touches and keeps the notebook up to date.

**3. Review** (recommended except for small tasks). Say *"review my changes before I open the PR"*. Example of what you get:

```text
1. src/features/cart/CouponField.jsx:42 — no error state when the coupon is
   invalid; users see nothing. Fix: show the API message under the field.
2. src/lib/money.js:18 — the return type changed, but catalog still reads a
   number. Fix: update catalog.
Passed: architecture check, imports, no secrets.
```

Then you decide: *"fix 1, 2 is intentional"*. Without sub-agents (Cursor, Copilot…) the same phrase works: the agent runs `npx reins review`, which gives it the diff, the checklist and the notes.

The reviewer checks the architecture, imports between areas, scope (did only what was asked), shared code with its callers updated, error and empty states, tests, notes and secrets. It's worth running when you touched shared code, several areas, or an area you don't know. **It doesn't replace the human PR review**: it catches the routine stuff, so the PR review can focus on product and design.

**4. Close.** When the agent finishes, it **suggests closing the task**. Accept, or type `/reins-done`. See below.

**5. Commit and PR.** You commit; the agent never does. If the change breaks the plan, the commit stops with the rule, why, and how to fix it. Paste it to your agent: *"fix this"*. CI runs the same check on the PR.

## Closing a task

**When:** the task is finished and you're happy with it, before committing or opening the PR. If the branch has several tasks, close each one.

**What happens:**

1. The agent runs the architecture check and a health check.
2. It writes what it learned into the notes: decisions with their reason, and traps.
3. It tells you what changed, what it verified and what it didn't.
4. It asks you to confirm. Only you decide it's done.
5. reins closes it only if every step is done and the notes are updated. If not, it says what's missing.
6. The notebook is deleted a week later. What matters is already in the notes, which are committed.

**If you don't close it:** it stays open on its branch. New sessions on that branch keep listing it, and its notebook is kept as long as the branch exists. What it learned only reaches the notes, and the next person, when you close it.

## Backlog and audits

While working, the agent often spots things worth improving that **aren't part of the current task**: duplicated code, a slow query, a component that should be split. Instead of fixing them on the spot (and turning a small task into a big one), it **writes them down in the backlog to tackle later**, and tells you. Example:

> *"While adding the coupon field I noticed price formatting is duplicated in 3 files in cart. It's not part of this task, so I saved it to the backlog."*

Each item keeps the file and a suggested fix, so whoever picks it up later doesn't have to rediscover it. When you want to work on it, ask for it as its own task, on its own branch: *"do backlog item 3"*.

The backlog is a local list in `.reins/backlog/`, not committed, and the same on every branch. **Each person has their own**; turn what matters to the team into a ticket.

| You want | Use | What it does |
| --- | --- | --- |
| See what's pending | `/reins-backlog` (or *"what's pending?"*) | Lists your backlog and helps you pick the next item. Doesn't read code: fast |
| Find improvements | `/reins-audit cart` | Reads the code and adds findings to your backlog. **Never changes code** |

**Using `/reins-audit`:**

1. **Always pass one area or folder.** Examples: `/reins-audit cart`, `/reins-audit src/components`. Without one it audits the whole repo, which is slow and expensive.
2. **Read the result:** each new finding comes with its file, the problem, a suggested fix and the areas it affects. It also lists the old items it re-checked (closes what was fixed, drops what no longer applies) and what it didn't look at.
3. **Act on a finding** as a normal task, on its own branch: *"do backlog item 3"*.
4. **Discard** with a reason: *"drop item 5, the two forms will diverge"*. Reasons worth keeping go into the area's note, so nobody proposes it again.
5. **Repeat now and then:** before a cleanup sprint, when you inherit an area, or after a big feature.

## The architecture map on each PR

CI posts **one comment** per PR, updated on every push:

- new dependencies between areas;
- new areas;
- folders no rule covers;
- who imports the changed code.

A new cross-area import stands out instead of hiding in the diff. If nothing structural changed, it's one line. To skip it on a PR, add the label `reins:no-map`.

## Customizing for the team

To customize the review checklist, an agent or a skill, copy its file from `.reins/core/` into the matching team folder (`.reins/review/`, `.reins/agents/`, `.reins/skills/`) and edit it. The team's copy wins. Example: *"add to our review checklist: API calls go through src/api, never fetch directly"*.

## Cheat sheet

| You want to | Ask your agent |
| --- | --- |
| Start a task | New branch, then *"add a coupon field to the cart"* |
| Resume a task in a new session | *"continue the coupon task"* |
| See what a shared file affects | *"what uses `src/lib/money.js`?"* |
| Review your changes | *"review my changes before I open the PR"* |
| Close the task | `/reins-done` |
| Fill in or refresh notes | `/reins-notes cart` · `/reins-notes review` |
| Add a domain | *"add a domain `auth` with src/pages/signIn and src/pages/resetPassword"*, or `/reins-arch` |
| Change what a domain covers | *"move src/components/checkout into the domain `cart`"* |
| Remove a domain | *"remove the domain `x` and its note"* |
| Add a note without a domain | *"create a note for the login flow, covering src/pages/signIn and src/api/auth.js"* |
| Remove a note | *"delete the note `x`"* |
| Change the plan | `/reins-arch` + what you want |
| See what's pending | `/reins-backlog` |
| Find improvements | `/reins-audit cart` |
| Create an agent | `/reins-agent` + what it should do |

## Updating reins

When a new version comes out, one person runs this and opens a PR:

```bash
npx reins update
```

Everyone else gets it with the next install.

## Without an agent

```bash
npx reins check   # checks the whole repo
```

## Good to know

- **Please don't skip the commit hook.** `git commit --no-verify` skips it, but the same check runs on the PR, so the problem only shows up later.
- **What to commit:** everything under `.reins/` except what's git-ignored (`progress/`, `backlog/`, `init-report.md`).
- **Edited a note, skill or agent by hand?** `npx reins sync` puts it in `AGENTS.md` and `.claude/`.
