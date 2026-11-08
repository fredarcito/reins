# reins

**Hold the reins of your coding agents: they respect your architecture and remember your project.**

Project site: **[fredarcito.github.io/reins](https://fredarcito.github.io/reins/)** · npm: [`@agentreins/cli`](https://www.npmjs.com/package/@agentreins/cli) · [`@agentreins/core`](https://www.npmjs.com/package/@agentreins/core) · [`@agentreins/adapter-js`](https://www.npmjs.com/package/@agentreins/adapter-js)

Coding agents write code fast, but they forget, in two ways:

- **They forget your architecture.** A shared component imports from a feature, one feature reaches into another's internals, an import cycle appears, and nobody notices until the codebase is a tangle. Rules written in a prompt or in `CLAUDE.md` help, until the agent skips them.
- **They forget your project.** You come back to a module a week later and the agent reads all of its code again to work out what it does and why it was built that way. A long conversation gets compacted, and the decisions of the task go with it.

reins fixes both:

- **Your architecture becomes a check.** It runs on every commit and every pull request, whatever agent wrote the code. When something breaks a rule, the commit is blocked with the reason and the fix, so the agent corrects it before you even review.
- **Each module gets a short note.** What it does, how it works, the decisions taken and why, and its traps. The note reaches the agent as soon as it opens a file of that module, and after a compaction the task's notebook comes back on its own. The agent starts from what the team already knows instead of rediscovering it.

**Made for** frontend teams on Vite + React or Next (plain JS/JSX or TypeScript) working with Claude Code, Codex, Cursor or any other agent.

## Without and with reins

| Without | With reins |
| --- | --- |
| A shared component imports from a feature. Someone spots it in review, or nobody does | The commit is blocked; the agent reads the fix and corrects it |
| A week later, the agent reads a whole module again to find out what it does and why | Its note (purpose, map, decisions with their why, traps) reaches the agent as soon as it opens the module |
| A long conversation gets compacted and the task's decisions are lost | The notebook and the notes of the files in play come back right after the compaction |
| Architecture rules live in a long prompt the agent skims | They live in `architecture.yml`, checked by a tool. The prompt stays at 45 lines |
| "Review the whole project" every few weeks, from scratch | Findings stay in a backlog; the next audit rechecks them |
| Adopting rules means fixing all the old debt first | Old debt is frozen in a baseline and can only shrink |

## Why use it

| | |
| --- | --- |
| 🔒 **Rules that can't be ignored** | Checked by a git hook and by CI, not by a prompt. Whatever agent or model wrote the code, it passes the same check. |
| 🧠 **Context that survives** | Module notes carry what a module does and why, from one session to the next. A per-branch notebook carries the task, and comes back by itself after a compaction. |
| 🟢 **Adopt it on the repo you already have** | `reins init` reads your code and drafts the architecture; `reins notes new` drafts a module's note from its imports. Today's violations are frozen in a baseline, so you start green and only *new* problems fail. |
| 🤖 **Errors an agent can fix alone** | Every finding says the rule, the reason and the fix, as text or JSON. |
| ✂️ **Less context, fewer tokens** | A 45-line `AGENTS.md` instead of a long prompt. A module's note arrives only when the agent works on that module. |
| 🔓 **No lock-in** | A Node CLI and plain markdown. No service, no API keys, no telemetry. Switch agents or models and nothing breaks; every piece is optional. |

## Quick start

In the root of your project (Node 22 or newer):

```bash
npm install -D @agentreins/cli @agentreins/adapter-js
npx reins install                  # git hook, CI job, AGENTS.md
# For a provider-neutral setup, use: npx reins install --skip-claude
npx reins init                     # architecture plan, baseline, module notes
npx reins check --update-baseline  # freeze today's violations
npx reins check                    # from now on, only new violations fail
```

Between `init` and `check --update-baseline`:

1. Review the architecture plan: in Claude Code, type `/reins-arch` (your agent proposes changes with evidence, you approve each one); otherwise read `.reins/init-report.md` and edit `.reins/architecture.yml`.
2. Have your agent fill in the module notes: in Claude Code, type `/reins-notes`; with other agents, ask *"fill in the TODO lines of the notes in .reins/notes/"*.

Later, after you add or edit a note, skill or agent in `.reins/` (by hand, with `reins notes new` or with `/reins-agent`), run `npx reins sync` so `AGENTS.md` and `.claude/` pick it up. `init` already does it for the notes it drafts.

User-owned files are not overwritten: `install` and `init` only add files or ask first; `sync` refreshes its marked/generated files. With pnpm, use `pnpm add -D` for the first line. More options: [Installation](#installation). Already installed? See [Updating](#updating). A full tour with real output: [`docs/walkthrough.md`](docs/walkthrough.md).

## Updating

```bash
# 1. Update the CLI and installed adapters, then sync the new core templates
npx reins update                   # preference persists; use --skip-claude or --claude to change it

# 2. Check the local workflow
npx reins doctor
npx reins check

# 3. Notes that fell behind their code (git history, no tokens);
#    review the top ones with /reins-notes review
npx reins notes stale
```

The shared workflow is provider-neutral: reins stores its rules in Markdown, exposes them through `AGENTS.md`, and gives any coding agent the same CLI commands. `reins update` uses the project's package manager (pnpm, yarn, bun, or npm), updates the CLI and installed `@agentreins/adapter-*` packages, then runs the newly installed `reins sync`. Use `--skip-claude` to update only the shared core and leave Claude Code files untouched.

Then read the [changelog](CHANGELOG.md) entry of each version you skipped: it says when something else is worth doing, such as running `reins init --dry-run` again to compare its proposal with your `architecture.yml`.

```mermaid
flowchart LR
    update["reins update"] --> pkg["latest CLI + installed adapters"]
    pkg --> sync["reins sync"]
    sync --> core[".reins/core/"]
    sync --> gen["managed AGENTS.md blocks<br/>read by compatible agents"]
    sync -. optional .-> claude["Claude Code adapter<br/>.claude/ · CLAUDE.md"]
    custom["your overrides in .reins/"] --> sync
```

What updates by itself and what doesn't:

| What | On update |
| --- | --- |
| `.reins/core/`, managed blocks in `AGENTS.md` | Refreshed by `reins sync` for the shared, provider-neutral workflow |
| `.claude/skills/reins-*`, `.claude/agents/reins-*`, reins hooks in `.claude/settings.json`, `CLAUDE.md` | Optional Claude Code adapter; use `reins sync --skip-claude` to leave it untouched |
| `.reins/skills/`, `.reins/agents/`, `.reins/policies/`, `.reins/templates/`, `.reins/review/` | Yours: `skills/`, `agents/`, `policies/` and `review/` each have a `README.md` (written by `sync`) saying what goes there. Kept as user overrides. Unmodified copies an older `reins install` put there are removed, so the new `.reins/core/` applies |
| The rules an older reins wrote in `AGENTS.md` (`## Always`, `## On demand`) | Moved into the managed rules block when unedited; if you edited them, `sync` warns and leaves them for you to move |
| An `AGENTS.md` you wrote yourself, with no reins rules block | Gets no rules from `update`: run `npx reins install` once to append the block (it keeps everything else), or add `<!-- reins:rules:start -->` and `<!-- reins:rules:end -->` where you want them |
| `AGENTS.md` outside the managed blocks, `architecture.yml`, `baseline.json`, your notes | Never touched |

When a version changes the templates, the changelog says so. Core templates sync automatically; review the changelog for behavior changes and compare any overrides you maintain:

```bash
diff -ru node_modules/@agentreins/cli/templates/.reins/core .reins/core
```

Finally, commit what changed: `.reins/`, `.claude/` and `AGENTS.md`.

## Skills for your agent

The workflow and skill sources are plain Markdown, independent of a model provider. In Claude Code, the optional adapter exposes commands such as `/reins-arch`; any other agent can follow `AGENTS.md`, read the same sources in `.reins/core/skills/` or `.reins/skills/`, and run the same `reins` CLI commands. Native skill discovery and automatic hooks are client-specific.

| Skill | What your agent does | When |
| --- | --- | --- |
| `/reins-done` | Closes a task: runs the checks once, updates the notebook and the notes of the modules it touched, says what was and wasn't verified | When a task is done |
| `/reins-backlog` | Shows what is pending in the backlog, proposes what to do next (checked against the code), adds, closes or drops items | "What's pending?", "what should we do next?" |
| `/reins-notes` | Reads each module and fills in its note. Writes only decisions it can back up; the rest become `- ? question` lines for you | After `init` or `notes new` |
| `/reins-notes review` | Checks notes against the code and fixes what is no longer true: the ones you name, or the top of `npx reins notes stale` (notes ranked by commits since they last changed) plus those doctor flags as `note-dead-paths`/`note-dead-refs` | Every few weeks, or when doctor flags notes |
| `/reins-arch` | Reviews `.reins/architecture.yml` against the code and proposes changes with evidence. **Applies nothing until you approve each one**, and never bends the plan just to make the check pass | After `init`, and every few months |
| `/reins-audit` | Looks for new improvements in the code and adds only new findings to the backlog | "Review the whole project" |
| `/reins-agent` | Creates a new subagent in `.reins/agents/` (read-only by default, the fewest tools) and generates it for Claude Code | When you want a new agent: a tester, an a11y checker… |

## Contents

- [Without and with reins](#without-and-with-reins)
- [Why use it](#why-use-it)
- [Quick start](#quick-start)
- [Updating](#updating)
- [Skills for your agent](#skills-for-your-agent)
- [The core idea: enforced vs. instructed](#the-core-idea-enforced-vs-instructed)
- [How it works](#how-it-works)
- [Context between sessions](#context-between-sessions)
- [What lands in your repo](#what-lands-in-your-repo)
- [Status of each piece](#status-of-each-piece)
- [Commands](#commands)
- [Installation](#installation)
- [Roadmap](#roadmap)
- [Developing this repo](#developing-this-repo)
- [Documentation](#documentation)

## The core idea: enforced vs. instructed

Everything in reins falls on one side of this line. The left side is guaranteed by tools; the right side guides the agent with short markdown, and works as long as the agent follows it.

| Enforced by a machine | Guidance for the agent |
| --- | --- |
| `reins check` in the git hook and in CI | Announcing the task level (triage) |
| `baseline.json` (existing violations are frozen) | Progress notebook |
| Integrity of `architecture.yml`, `baseline.json` and generated files | Module notes, policies, skills, agents |
| Branch protection: PR with human approval + CI green | Audit backlog |
| Claude Code permissions denying `git commit` / `git push` (a first line of defense: [details](docs/VERIFIED.md#p2-permissions-denying-git-commit--git-push--partial-pass)) | Multi-agent rules |

`reins doctor` sits in the middle: it warns locally about what the agent wrote (triage log, notebook), but never blocks and never runs in CI.

## How it works

### Three layers

From most to least durable. Each layer only depends on the ones below it.

```mermaid
flowchart TB
    subgraph L3["3 · Tool adapters (generated, no logic)"]
        direction LR
        claude[".claude/<br/>settings, skills, agents"]
        husky[".husky/pre-commit"]
        agentsmd["AGENTS.md index"]
    end
    subgraph L2["2 · Markdown content (portable)"]
        direction LR
        notes["notes/"]
        policies["policies/"]
        skills["skills/ · agents/"]
    end
    subgraph L1["1 · Deterministic core (Node + git, no agent)"]
        direction LR
        arch["architecture.yml"]
        base["baseline.json"]
        check["reins check"]
        ci["CI job"]
    end
    L3 -- "generated by reins sync" --> L2
    L2 --> L1
```

Each layer is optional: if one doesn't pay off for your team, delete it and the others keep working. Layer 3 is meant to be thrown away and regenerated when agent tools change their formats.

### What happens on a commit

```mermaid
flowchart LR
    agent["Agent edits code<br/>(never commits)"] --> human["You review<br/>and commit"]
    human --> hook{"pre-commit hook<br/>reins check<br/>(touched files)"}
    hook -- "new violation" --> fix["Error with rule,<br/>reason and fix"]
    fix --> agent
    hook -- "ok" --> pr["Push + PR"]
    pr --> ci{"CI<br/>reins check<br/>(whole project)"}
    ci -- "fail" --> fix
    ci -- "green + approval" --> main["main"]
```

The hook can be skipped with `--no-verify`, so **CI plus branch protection is the real guarantee**. The hook is there to fail fast.

### How `check` sees your code

The core never opens a `.js` file. A language adapter turns the repo into a list of edges, and the core applies the rules to that list.

```mermaid
flowchart LR
    repo["Your repo<br/>.js .jsx .ts .tsx<br/>@/ aliases"] --> adapter["adapter-js<br/>(dependency-cruiser)"]
    adapter -- "[{ from, to, kind }]" --> core["core rules<br/>layer-direction<br/>domain-boundary<br/>no-cycles"]
    yml["architecture.yml"] --> core
    baseline["baseline.json"] --> core
    core --> report["Report<br/>text or JSON"]
```

Rules:

| Rule | Fails when | Example |
| --- | --- | --- |
| `layer-direction` | A layer imports from a layer above it | `components/Button` imports from `features/billing` |
| `domain-boundary` | Code imports a domain's internals instead of its public API | `features/search` imports `features/billing/total.js` instead of `features/billing/index.js` |
| `no-cycles` | Modules import each other in a loop | `a → b → c → a` |
| `next-server-client` (optional, Next) | A `'use client'` component reaches a module that imports `server-only` or `next/headers` | `OrderList.tsx` (client) → `queries.ts` → `lib/db.ts` (`import 'server-only'`) |

Plus `integrity`, which warns when a PR changes `architecture.yml` or makes `baseline.json` grow (see below).

### Reading a report

Every finding says **which rule**, **why** and **how to fix it**, so an agent can fix it without asking:

```
✖ error layer-direction  src/components/PriceTag.js → src/features/billing/index.js
    Why: src/components/PriceTag.js (components) imports src/features/billing/index.js (features), but features is above components.
    Fix: Move what src/components/PriceTag.js needs from features down to components or a lower layer, or invert the dependency (pass it in as props or callbacks).

✖ error no-cycles  src/lib/a.js → src/lib/b.js
    Why: Import cycle: src/lib/a.js → src/lib/b.js → src/lib/c.js → src/lib/a.js.
    Fix: Break the cycle: move the code both sides need into a lower module, or invert one of the imports.

reins check: 2 new (2 errors, 0 warnings) · 0 in baseline · 0 fixed
Result: FAIL (new errors)
```

With `--json` the same data comes as JSON with a stable `schema` number, one object per finding: `rule`, `severity`, `status` (`new` / `baseline`), `from`, `to`, `message`, `fix`.

### Baseline: start green, only fail on new problems

A real repo already has violations. Fixing them all before adopting reins isn't realistic, so they are frozen in `baseline.json` and `check` only fails on **new** ones.

```mermaid
flowchart TB
    v["Violation found"] --> q{"In baseline.json?"}
    q -- "yes" --> old["Existing: reported as a count,<br/>does not fail"]
    q -- "no" --> sev{"severity"}
    sev -- "error" --> fail["New: FAILS check"]
    sev -- "warn" --> warn["New: reported,<br/>does not fail"]
    b["Entry in baseline.json"] --> occ{"Still happens?"}
    occ -- "no" --> fixed["Fixed: suggest removing it<br/>(the baseline should only shrink)"]
```

```mermaid
flowchart LR
    pr["PR"] --> integ{"integrity<br/>vs. base branch"}
    integ -- "architecture.yml changed" --> w1["warn: explain it in the PR"]
    integ -- "baseline.json grew" --> w2["warn: you froze a new violation<br/>instead of fixing it"]
    integ -- "nothing" --> ok["silent"]
```

- **Baseline** = existing mess to fix someday. **`allow:`** = a decision, with a reason, that stays.
- `integrity` is `warn` by default; set it to `error` in `architecture.yml` to make those changes block.

Full reference of the file, rules, globs and defaults: [`docs/architecture-yml.md`](docs/architecture-yml.md).

### How the JS adapter reads your project

Aliases are the most likely source of silent bugs: if `@/features/x` doesn't resolve, that edge disappears and `check` can't see the violation. So the adapter reads them itself and **warns** about anything it can't resolve.

```mermaid
flowchart TB
    subgraph sources["Alias sources (read as text, never executed)"]
        direction LR
        ts["tsconfig.json / jsconfig.json<br/>paths · baseUrl<br/>(+ extends, + references<br/>→ tsconfig.app.json)"]
        vite["vite.config.*<br/>resolve.alias<br/>(object or array)"]
    end
    sources --> alias["@/ → src/ …"]
    alias --> dc["dependency-cruiser"]
    files[".js .jsx .ts .tsx"] --> dc
    dc --> edges["edges<br/>static · dynamic · type"]
    dc --> unresolved["unresolved local imports<br/>→ warning"]
    preset["preset<br/>vite-react · next-app · next-pages"] --> entries["entry points<br/>(Next page/layout/route, main.jsx…)"]
```

| Project | Works | Notes |
| --- | --- | --- |
| Vite + React, **plain JS/JSX** | ✅ | Nothing extra to install. Aliases from `jsconfig.json` or `vite.config.js` |
| Vite + React, TypeScript | ✅ | Needs `typescript` in the repo (it already is). Reads `tsconfig.app.json` through `references` |
| Next app router (JS or TS) | ✅ | `page`, `layout`, `route`… are entry points, not orphans |
| Next pages router (JS or TS) | ✅ | Every file under `pages/` is an entry point |

TypeScript repos use the `typescript` package they already have. If it's missing, the adapter says so clearly instead of skipping `.ts` files, so a green `check` always means the whole repo was checked.

### Packages and dependency direction

```mermaid
flowchart LR
    cli["@agentreins/cli<br/>reins command"] --> core["@agentreins/core<br/>rules · config · report"]
    cli -. "loads at runtime<br/>from your project" .-> adapter["@agentreins/adapter-js<br/>Vite · Next"]
    adapter -- "peerDependency<br/>imports only /contract" --> core
```

- `core` knows no framework and never imports `cli` or an adapter.
- Adapters only see `@agentreins/core/contract` (enforced by the `exports` field).
- Adapters are installed separately; if one is missing, the CLI tells you which one. It never installs anything.
- `@agentreins` is the npm organization of every package; the command is `reins`.

## Context between sessions

Two kinds of memory, both plain markdown in `.reins/`:

| | Module note | Task notebook |
| --- | --- | --- |
| File | `.reins/notes/<module>.md`, **in git** | `.reins/progress/<branch>/<task>/notebook.md`, local |
| Lives | As long as the module | As long as the task |
| Holds | Purpose, map, how it works, decisions with their why, traps | Goal, done criteria, subtasks, next step |
| Written by | `reins init` drafts one per domain and `reins notes new` one for any folder; the agent fills in and updates it when closing a task | The agent, one line at a time with `reins progress` |

```mermaid
flowchart LR
    subgraph mem["Memory in .reins/"]
        direction TB
        note["notes/cart.md"]
        nb["progress/feat-x/css/notebook.md"]
    end
    subgraph when["When it reaches the agent"]
        direction TB
        open["Opens a file of the module<br/>PreToolUse hook"]
        start["Session start, /clear,<br/>compaction<br/>SessionStart hook"]
        any["Any agent<br/>AGENTS.md index ·<br/>reins resume"]
    end
    note --> open
    note --> start
    nb --> start
    note --> any
    nb --> any
    open --> agent["Agent"]
    start --> agent
    any --> agent
```

**Coming back to a module a week later.** The agent opens `src/features/cart/cartStore.js` and, before it edits anything, receives:

```markdown
## Purpose
Cart state and totals for the checkout.

## Map
- Public API: `src/features/cart/index.js`
- `cartStore.js`: the single source of truth; components only read from it.

## Decisions
- 2026-10-28: totals are integer cents. Why: float rounding broke the invoices.

## Traps
- `clear()` keeps the coupon on purpose: the coupon belongs to the session, not to the cart.
```

**What goes in each section.** A note is for someone who has never seen the module and has to change it safely today. If the code already says something clearly, it doesn't go in the note.

| Section | What it is | Example | Doesn't belong |
| --- | --- | --- | --- |
| **Purpose** | What the module does and for whom, in one or two lines. The question it answers: "do I need to touch this module for my task?" | "Cart state and totals for the checkout." | How it does it; history |
| **Map** | Where things are: the public API (the only entry point for other modules) and the key files, one line each on what they are for. `notes new` fills in the parts the import graph knows | "`cartStore.js`: the single source of truth; components only read from it." | A list of every file; what each function does line by line |
| **How it works** | The main flow in a few lines: where the data comes from, what changes it, who reads it. What you'd otherwise rebuild by reading several files | "Components dispatch actions to `cartStore`; `totals.js` recomputes on every change; the checkout page only reads." | Details that are obvious from a single file |
| **Decisions** | Choices that were made on purpose, with a date and **why**, ideally with what was rejected. They stop the next session from "fixing" something that was decided | "2026-10-28: totals are integer cents. Why: float rounding broke the invoices." | Decisions without a why; things that are just how the framework works |
| **Traps** | What looks wrong but is intentional, and invariants that must hold. Where a reasonable change breaks something | "`clear()` keeps the coupon on purpose: the coupon belongs to the session." | General bugs (those go to the backlog) |

A **decision** answers "why is it like this?"; a **trap** warns "careful: this looks wrong, and it isn't". When a decision is reversed, update or delete its line: an outdated note is worse than none.

**A conversation gets compacted.** Claude Code fires the `SessionStart` hook with `compact`; `reins resume --hook` puts back the session's task notebook, the files the task changed and their module notes. Verified with Claude Code: after a compaction the model quoted a notebook and a note that had changed on disk in the meantime ([details](docs/VERIFIED.md#p9-sessionstart-hook-after-a-compaction--pass)). Other agents get the same text with `npx reins resume`.

**Several tasks on one branch.** Talk normally. To work in parallel, open another session and tell it which part is its own ("you do the CSS, the other session is on the JS"). Each task gets its own notebook, so the agents keep the books for you:

- a new session never picks up someone else's task by itself; it creates its own, or continues one when you ask it to;
- each session sees one line per task the others have open, so the session that verifies knows what is in flight;
- when a request overlaps another session's task, the agent asks you before touching it;
- finished notebooks tidy themselves away a week after you close the task.

```mermaid
flowchart LR
    you(["You"]) --> s1["Session 1<br/>refactor the JS"]
    you --> s2["Session 2<br/>refactor the CSS"]
    you --> s3["Session 3<br/>check that it all works"]
    s1 --> n1["feat-checkout/js-refactor/"]
    s2 --> n2["feat-checkout/css-refactor/"]
    s3 --> n3["feat-checkout/verify/"]
    n1 -. "one line each,<br/>in reins resume" .-> s3
    n2 -. "one line each,<br/>in reins resume" .-> s3
```

Each session writes only its own notebook and reads the others. Coming back tomorrow in a new session, just say "continue the CSS work": the agent finds the task and carries on.

**Modules with parts.** A big module keeps the notes of its parts in a folder named after it, one level deep. The module's note holds what every part shares and lists the parts; each part's note holds only what is specific to it. In the `AGENTS.md` index the parts go on their module's line, so it doesn't grow a line per part.

```
.reins/notes/
  auth.md
  companies.md          the module: shared context, lists its parts
  companies/
    salaries.md         a part: only what is specific to salaries
    reviews.md
  jobs.md
```

**Adding one.** `init` drafts a note per domain (a `features/*` folder, or each route folder when there are none). A route domain with several parts (say `(companies)` with `companies/[slug]/salaries`, `reviews`, `jobs`…) also gets one note per part with two or more source files, up to 12 per domain. Notes stack: an agent working in `salaries/` reads the `companies` note first, for the shared context, and then the `salaries` note, for what is specific there. Parts are only notes, not domains, so they add no rules. For any other module, `reins notes new <folder>` drafts one (a folder inside a domain becomes one of its parts), or write `.reins/notes/<name>.md` yourself: only the `paths` frontmatter is required, and it decides when the note is delivered, so include the module's folders outside its route too (e.g. `src/components/jobs/**`). Then run `reins sync` to list it in the `AGENTS.md` index; the Claude Code hook reads `.reins/notes/` directly, so it delivers the note right away.

**Filling them in.** `/reins-notes` (a Claude Code skill installed by `reins sync`) has the agent read each module and replace the `TODO` lines. It writes only decisions it can back up (code, comments, git history) and leaves the rest as `- ? question` lines for you to answer.

**Notes stay current.** The `reins-done` skill updates the notes of the modules a task touched, and `reins doctor` warns when a medium or large task changed a module without touching its note, or touched a domain that has no note.

**Catching notes that fell behind.** Code moves on in small fixes too, which never trigger the warnings above. Three checks cover that, from free to paid:

```mermaid
flowchart LR
    doctor["reins doctor<br/>every note, no tokens"] --> dead["note-dead-paths<br/>paths match no file"]
    doctor --> refs["note-dead-refs<br/>names files that are gone"]
    stale["reins notes stale<br/>git history, no tokens"] --> rank["notes ranked by commits<br/>since they last changed"]
    rank --> review["/reins-notes review<br/>agent checks the top ones<br/>against the code (tokens)"]
    dead --> review
    refs --> review
```

`note-dead-paths` matters most: a note whose paths match nothing reaches nobody, silently. `reins notes stale` is a signal, not proof; the review is what checks that a note is still true, and it only runs when you ask for it.

### How the skills fit in

After `init`, two skills turn the drafts into something you can trust; you approve the architecture changes one by one.

```mermaid
flowchart LR
    init["reins init"] --> review["/reins-arch<br/>proposal with evidence"]
    review --> you{"You approve<br/>each change"}
    you --> plan["architecture.yml"]
    init --> fill["/reins-notes"]
    fill --> notes["notes/*.md<br/>+ open questions"]
    plan --> check["reins check --update-baseline"]
```

Your own agents and skills follow the same path: write them in `.reins/agents/` or `.reins/skills/` (or ask `/reins-agent`), run `reins sync`.

## What lands in your repo

After installing, a consumer repo gets this. Files marked *local* stay out of git.

```
your-repo/
├── AGENTS.md                      # ≤ 45 lines: commands, golden rules, path → note index (generated)
├── CLAUDE.md                      # one line: @AGENTS.md
├── .reins/
│   ├── architecture.yml           # layers, domains, rules, exceptions  ← you decide this
│   ├── baseline.json              # frozen existing violations
│   ├── doctor.yml                 # doctor thresholds
│   ├── notes/<module>.md          # per module: purpose, map, how it works, decisions, traps
│   ├── policies/                  # triage, progress, multiagent
│   ├── skills/  agents/           # sources for .claude/skills and .claude/agents
│   ├── review/checklist.md
│   ├── hooks/pre-commit.sh        # one line: reins check
│   ├── backlog/                   # local: audit findings
│   └── progress/                  # local: triage.log and one notebook per task (<branch>/<task>/)
├── .claude/                       # generated by reins sync, no logic of its own
├── .husky/pre-commit              # calls .reins/hooks/pre-commit.sh
└── .github/workflows/reins.yml  # CI job: reins check
```

Example `architecture.yml`:

```yaml
version: 1
adapter: js
preset: next-app

layers:                       # each layer may only import from the layers below it
  - { name: pages,      paths: ["src/app/**"] }
  - { name: features,   paths: ["src/features/**"] }
  - { name: components, paths: ["src/components/**"] }
  - { name: shared,     paths: ["src/hooks/**", "src/utils/**", "src/lib/**"] }

domains:
  billing: { paths: ["src/features/billing/**"], public_api: ["src/features/billing/index.js"] }

rules:
  - { id: layer-direction, severity: error }
  - { id: domain-boundary, severity: error }
  - { id: no-cycles,       severity: error }

allow:
  - { from: "src/features/search/**", to: "src/features/billing/**",
      reason: "Search shows prices; decided 2026-11" }
```

```
pages        ─┐
features      │  imports only go downwards
components    │
shared       ─┘
```

## Status of each piece

Everything below is built and tested. **Stable** pieces are enforced by tools. **Experimental** pieces guide the agent (notes, skills, notebook…): they work, and the team pilot will tell us which ones are worth keeping. Details: [`docs/STATUS.md`](docs/STATUS.md).

| Piece | Kind | Status |
| --- | --- | --- |
| `reins check`: layers, domains, cycles, baseline, integrity | stable | ✅ |
| `reins init`: draft plan, baseline and report | stable | ✅ |
| `adapter-js`: Vite + React and Next, JS or TS, `@/` aliases | stable | ✅ tested on [`examples/`](examples/) |
| `next-server-client` rule | stable (optional) | ✅ |
| Git hook (Husky, lefthook) + CI job | stable | ✅ blocks bad commits and PRs end to end |
| `reins install`, `reins update` | experimental | ✅ install tested with npm and pnpm; update package-manager selection tested in dry-run; shared `AGENTS.md` workflow does not require Claude Code |
| `reins sync`, `notes`, `scope` | experimental | ✅ notes reach Claude Code before it edits |
| `reins impact` | experimental | ✅ the domains that consume a file, before the refactor |
| `reins notes new`, `resume` + `SessionStart` hook | experimental | ✅ notebook and notes come back after a compaction |
| Skills `arch`, `notes`, `agent` | experimental | ✅ tested with Claude Code |
| Templates: `AGENTS.md`, policies, skills, agents | experimental | ✅ |
| `reins doctor` | experimental | ✅ |
| `reins audit`, `progress`, `review` | experimental | ✅ |

## Commands

### `reins init`

Drafts the plan from the code. The code says what exists, not what should exist, so the result is a draft for a person to review.

```mermaid
flowchart LR
    scan["Scan the repo<br/>(adapter graph)"] --> layers["Layers: preset folders<br/>that exist, ordered by<br/>dominant import direction"]
    scan --> domains["Domains: one per<br/>features/* folder,<br/>public API = its index"]
    domains -. "no features/" .-> routes["Domains: one per<br/>route folder<br/>(app/*, src/routes/*…)"]
    routes --> owned["+ folders only that<br/>route imports<br/>(components/…)"]
    owned --> draft
    routes --> notes["Module notes<br/>(one draft per domain,<br/>plus one per part<br/>of a route domain)"]
    domains --> notes
    layers --> draft["architecture.yml<br/>(draft)"]
    domains --> draft
    draft --> run["Run check on the draft"]
    run --> baseline["baseline.json<br/>(today's violations)"]
    run --> report["init-report.md<br/>cycles · doubtful deps<br/>orphans · warnings"]
```

**Repos organized by routes.** With no `features/*` or `modules/*` folder, each route folder becomes a domain:

- Next route groups `(main)` and parameters `[slug]` are looked through: they share a layout or a URL segment, they are not features. `(companies)/companies/[slug]` gives a domain `companies`, and a route split across groups (`(companies)/companies` and `(main)/companies`, both `/companies`) is one domain with several folders.
- A route folder with a single source file (a lone `page.js`: about, terms…) is left out and listed in the report.
- A route's logic often lives outside its folder (`components/pages/companies/`, `components/JobBoard/`…). The import graph decides where it belongs, never folder names. Inside a folder organized by feature (`components/pages/`), each subfolder joins, whole, the domain that makes most of its imports; the few imports from elsewhere are frozen in the baseline and counted in the report. A folder that is not organized by feature (`components/shared/`) is shared code, and so is the lowest layer (`utils/`, `constants/`): nothing there is assigned.
- Imports through a re-export file (`import { JobBoard } from '@/components'` with `components/index.js` re-exporting everything) count as imports of the file behind it, so a barrel doesn't make every page look like it uses every component.
- A loose file only one route uses (`components/paginaContacto.js` next to shared ones) goes in that route's note, so the agent gets the context when it opens the file; it never goes into the rules.
- The report says, for each domain, how many imports reach it from outside. A domain whose public API is only route files (`page.js`, `layout.js`) is closed: nothing outside may import its files.

| Option | Effect |
| --- | --- |
| `--preset <name>` | `vite-react`, `next-app` or `next-pages` (default: detected) |
| `--dry-run` | Print the draft and the report, write nothing |
| `--force` | Overwrite existing files without asking (otherwise it asks, or refuses when there is no terminal) |

If the adapter is missing, it prints the install command for your package manager. It never installs anything.

### `reins check`

| Option | Effect |
| --- | --- |
| `--files <a,b>` | Only report violations involving these files (what the pre-commit hook runs) |
| `--json` | Machine-readable output for agents |
| `--base <ref>` | Base branch for `integrity` (default: `$GITHUB_BASE_REF`, `origin/HEAD`, `origin/main`, `main`) |
| `--update-baseline` | Freeze the current violations into `baseline.json` |
| `--verbose` | Also list violations already in the baseline |
| `--coverage` | Instead of checking, show what the plan covers: files per layer and domain, folders outside every layer (not checked), imports between layers, exceptions and the baseline. With `--json` for agents |

Exit codes: **0** no new errors · **1** new errors · **2** could not run (config, adapter, options).

### `reins doctor`

Local, informational checks of **how the work is going**, not of the code. It reads files the agent writes, so it only sees what the agent wrote.

|  | `reins check` | `reins doctor` |
| --- | --- | --- |
| Guarantees | What enters git follows the rules | How the local workflow is going |
| Looks at | The code (import graph) | `triage.log`, the progress notebook, `AGENTS.md`, the local diff |
| Result | Blocks on new errors | Warnings only; exit 0 unless `--strict` |
| Runs in | Git hook and CI | Your machine, when the agent closes a task. **Never in CI** (skipped when `CI` is set) |
| Baseline / adapter | Yes / yes | No / no |

```mermaid
flowchart LR
    log["triage.log<br/>2026-11-04 · feat/x · small · fix button · commit:3f9c…"] --> cmp{"level of the current task<br/>vs. its diff"}
    diff["git diff since the task's commit<br/>files · domains · public API"] --> cmp
    cmp -- "diff needs more" --> mismatch["triage-mismatch"]
    cmp -- "no line for the branch" --> missing["triage-missing"]
    nb["progress/BRANCH.md"] --> fmt["progress-format<br/>progress-hot-size<br/>progress-closed"]
    agents["AGENTS.md"] --> size["agents-size"]
```

| Rule | Warns when |
| --- | --- |
| `triage-missing` | The branch has changes but no line in `triage.log` (or a line can't be read) |
| `triage-mismatch` | The current task's diff exceeds its declared level: `small` = ≤ 3 files in 1 domain; `medium` = 1 domain; more domains, a public API or `architecture.yml` = `large` |

The agent records each level with `npx reins triage <level> "<reason>"`, which also notes the commit the task starts from. So the doctor looks at **this task's** changes (since that commit, plus uncommitted ones), even on `main` or a long-lived branch where older tasks piled up. `reins resume` tidies the log by itself: lines of deleted branches and of tasks already merged go away.
| `agents-size` | `AGENTS.md` is longer than 45 lines (`sync` keeps its notes index inside this limit) |
| `progress-hot-size` | The hot notebook is longer than 40 lines |
| `progress-format` | Missing header, invalid marker, more than one `[~]`, or a `[-]` without a reason |
| `progress-closed` | `status: closed` with done criteria not checked |
| `note-missing` | A medium or large diff touched a domain that has no module note |
| `note-outdated` | A medium or large diff changed a module's files but not its note |
| `note-draft` | A note of a touched module still has `TODO` lines from its draft; many drafts make a single warning |
| `note-size` | A note of a touched module is longer than 60 lines |
| `note-layout` | A note of a touched module is more than one folder deep, or is a part whose module note is missing or whose paths are outside that module |
| `note-dead-paths` | Any note: a glob in its `paths` matches no file, so the note may reach nobody (several notes: one warning) |
| `note-dead-refs` | Any note: it names, in backticks, a repo file or folder that no longer exists (several notes: one warning) |

Thresholds are starting values in `.reins/doctor.yml`; tune them to your team:

```yaml
triage:
  small:  { max_files: 3, max_domains: 1 }
  medium: { max_domains: 1 }
agents_md: { max_lines: 45 }
progress:  { hot_max_lines: 40 }
notes:     { max_lines: 60 }
```

Notebook format (`.reins/progress/<branch>/<task>/notebook.md`, local, outside git; reins writes `task:` and `session:`):

```markdown
# feat/discounts · task: discounts · session: 3f9c… · status: open · updated: 2026-11-04
**Goal:** apply discounts in the cart.
**Done criteria:**
- [ ] discount applied to the total
- [ ] `reins check` without new violations
**Subtasks:**
- [x] model            (written, not tested)
- [~] UI               (in progress: only one)
- [-] coupons — out of scope, ticket 42
**Next step:** wire the UI.
```

### `reins sync`, `reins notes`, `reins scope`, `reins impact`, `reins resume`

`sync` refreshes the provider-neutral core sources and managed `AGENTS.md` blocks. By default it also generates the optional Claude Code adapter; `--skip-claude` updates only the shared files and leaves existing Claude files untouched. It only touches generated files recorded in `.reins/.generated.json`.

```mermaid
flowchart LR
    subgraph src[".reins/ (sources, in git)"]
        core["core/skills · core/agents<br/>core/policies · core/templates"]
        skills["skills/ (user overrides)"]
        agents["agents/ (user overrides)"]
        notes["notes/*.md<br/>(paths in frontmatter)"]
    end
    subgraph gen["generated (in git, never edit)"]
        index["AGENTS.md<br/>shared rules + notes blocks"]
        claude["optional Claude Code adapter<br/>.claude/ skills, agents, hooks"]
    end
    core -. optional adapter .-> claude
    skills -. optional adapter .-> claude
    agents -. optional adapter .-> claude
    notes --> index
    sync(["reins sync"]) --> index
    sync -. unless --skip-claude .-> claude
    manifest[".reins/.generated.json<br/>what reins owns"] -.-> sync
```

| Situation | What `sync` does |
| --- | --- |
| Third-party skill, agent or setting (e.g. another tool's hook) | Never touched |
| A file at a generated path that reins didn't create | Not touched; warning |
| A generated file edited by hand | Overwritten, with a message (edit the source instead); `--check` fails |
| A source deleted | Its generated files are removed (kept if edited by hand) |
| `AGENTS.md` / `CLAUDE.md` missing | Created from the templates; afterwards they belong to the repo (only marked reins blocks are managed) |
| Notes index | Its first line asks the agent to run `npx reins notes <path…>` before changing a file, then one line per note; hooks are an optional client-specific fast path |
| More notes than fit in `AGENTS.md` | Only that first line and the number of notes, so `AGENTS.md` stays within doctor's `agents_md.max_lines` |

`sync --check` writes nothing and fails if anything differs. Once `.generated.json` exists, `reins check` reports the same differences under `integrity`.

**How a module note reaches the agent:**

```mermaid
sequenceDiagram
    participant A as Agent (Claude Code)
    participant H as PreToolUse hook
    participant N as reins notes --hook
    A->>H: Read src/features/cart/cartStore.js
    H->>N: { session_id, tool_input.file_path }
    N->>N: notes whose paths match,<br/>not yet seen in this session
    N-->>A: additionalContext: "money is integer cents…"
    A->>A: Edit, already following the note
```

The `AGENTS.md` index line works with any agent (Codex, Cursor); the hook is the Claude Code fast path. Tested with Claude Code: the note arrives when the file is read, so the very first edit already follows it ([details](docs/VERIFIED.md#phase-6-findings)).

`scope` goes **path → domain**: the files a task will touch. `impact` goes the other way, **file → consuming domains**, and answers the question an agent has before touching a shared file: *who else imports this?*

```mermaid
flowchart LR
    ann["announce the level<br/>(triage policy)"] --> imp["reins impact the file"]
    imp --> plan["plan with the real<br/>blast radius"]
    plan --> edit["edit"]
    edit --> chk["reins check confirms<br/>instead of surprising"]
```

```console
$ npx reins impact src/lib/date.ts
File: src/lib/date.ts (no domain)
Imported by: 2 files — billing (1), no domain (1)
Public API: no
Boundary crossings: none
Existing violations: 1 (no-cycles new; run `reins check --files src/lib/date.ts` to see them)
Notes to read: .reins/notes/lib.md
Minimum level (if the change breaks importers): small (3 file(s) in 1 domain)
```

Boundary crossings are imports that reach a domain's internals instead of its public API — the same leak `domain-boundary` reports, counted with every import kind (a type-only import also breaks when the type changes). Importers that go through a barrel (`import { x } from '@/lib'`) count as consumers of the file behind it, not just of the barrel. Symbol-level questions stay with grep, inside the domains listed. The generated `AGENTS.md` tells agents when to run it (restructuring a domain or folder, or editing a file other code may import), at every task level.

| Command | What it does |
| --- | --- |
| `reins notes <path…>` | Prints the notes that apply to each path |
| `reins notes --hook` | The same, as the Claude Code hook (JSON in/out, once per note and session) |
| `reins notes stale` | Notes ranked by commits to their paths since the note last changed (git history). `--limit <n>` (default 10, 0 for all), `--json` |
| `reins notes new <domain\|folder>` | Drafts `.reins/notes/<name>.md` from the import graph: public API, most imported files, who uses the module, what it depends on. The rest are `TODO` lines to fill in. `--paths` sets the globs, `--force` overwrites |
| `reins resume` | This session's task notebook, one line per other open task on the branch, the files the task changed and their notes: what an agent needs to pick a task up. Also tidies old notebooks and triage lines. `--json` for agents |
| `reins resume --hook` | The same, as the Claude Code `SessionStart` hook (startup, `/clear`, compaction). After a compaction the notes are delivered again |
| `reins scope <path…>` | Domains, public APIs, notes to read and the minimum task level (`small` / `medium` / `large`) |
| `reins impact <file-or-folder>` | The reverse of `scope`: the domains that consume a file, imports that bypass a public API, violations that already involve it, and the minimum level if the change breaks its importers. `--json` |

### `reins audit`, `reins progress`, `reins review`

Small commands so the agent edits local state **one line at a time** instead of rewriting files (cheaper, and the format can't break).

**`reins audit`**: the audit backlog, so "review the whole project" doesn't start from zero every few weeks.

```mermaid
flowchart LR
    list["audit list"] --> recheck["re-verify open items<br/>against the code"]
    recheck -- "fixed" --> done["audit set A3 done + how"]
    recheck -- "no longer applies" --> wont["audit set A4 wontfix + why<br/>(durable reason: module note)"]
    recheck --> add["audit add path finding<br/>(duplicates refused,<br/>wontfix ones included)"]
```

```markdown
- [open] A1 · 2026-11-04 · `src/lib/format.js` · Cache Intl.NumberFormat per locale.
- [open] [recheck] A2 · 2026-11-04 · `src/features/cart/` · Memoize the totals.
- [wontfix] A3 · 2026-11-04 · `src/api/` · Batch requests. — wontfix 2026-11-06: the API has no batch endpoint
```

| Command | Effect |
| --- | --- |
| `audit list [--status open\|done\|wontfix\|all] [--recheck]` | Show findings (default: open) |
| `audit add <path> <finding>` | New open finding |
| `audit set <id> <status> <reason>` | `done`/`wontfix` need a reason; clears `recheck` |
| `audit recheck <id…> \| open` | Flag findings to verify again |

**`reins progress`**: edits the branch notebook (`.reins/progress/<branch>.md`) and refuses anything that would break its format.

| Command | Effect |
| --- | --- |
| `progress new [--hot]` | Notebook from `.reins/templates/` (mini; `--hot` adds the cold folder). Adapt those templates to your team; a missing one falls back to the packaged default |
| `progress show` | Numbered items |
| `progress add <text> [--criteria]` | `- [ ]` in Subtasks (or Done criteria) |
| `progress start <n>` | `[~]`; any other `[~]` goes back to `[ ]` |
| `progress done <n>` | `[x]` |
| `progress drop <n> <reason>` | `[-] … — reason` (kept, so it isn't proposed again) |
| `progress next <text>` | The "Next step" line |

**`reins review`**: prints a review prompt (instructions, changed files, checklist, notes of the touched paths, diff including uncommitted and untracked files) for any agent. It calls no API; `--executor` is the extension point for a future runner.

## Installation

The packages are on npm under `@agentreins`. Without a registry (offline, or a version not published yet), install from tarballs: [`docs/team-install.md`](docs/team-install.md). To just try `init` and `check` on a branch first: [`docs/try-it.md`](docs/try-it.md).

```bash
# 1. Install the CLI and the JavaScript/TypeScript adapter (pnpm: pnpm add -D …)
npm install -D @agentreins/cli @agentreins/adapter-js

# 2. Wire it: .reins/ sources, .gitignore, pre-commit hook (Husky or lefthook), CI workflow, AGENTS.md
npx reins install --skip-claude    # omit optional Claude Code files for a provider-neutral setup

# 3. Draft the architecture and the module notes, review init-report.md, adjust architecture.yml,
#    ask your agent to fill in the notes' TODO lines, then freeze today's violations
npx reins init
npx reins check --update-baseline

# 4. Check, commit everything, and protect the main branch in GitHub (PR + approval + "reins" job required)
npx reins check
```

```mermaid
flowchart LR
    install["reins install"] --> src[".reins/ starter sources<br/>hook · doctor config"]
    install --> gi[".gitignore<br/>backlog/ · progress/"]
    install --> hook[".husky/pre-commit<br/>or lefthook.yml"]
    install --> wf[".github/workflows/reins.yml<br/>reins check only"]
    install --> sync["reins sync<br/>.reins/core · AGENTS.md · CLAUDE.md · .claude/"]
```

`reins install` is additive and idempotent: it never overwrites existing files (the workflow only with `--force`; existing `AGENTS.md` gets managed rules and notes blocks appended when missing), never installs packages, and tells you what is missing (e.g. no Husky or lefthook: it explains how to add one). `--dry-run` shows what it would do.

Supported projects: Vite + React and Next (app and pages router), in **plain JS/JSX or TypeScript**. See [How the JS adapter reads your project](#how-the-js-adapter-reads-your-project).

## Roadmap

```mermaid
flowchart LR
    p0["0 · Verify<br/>assumptions"]:::done --> p1["1 · Skeleton"]:::done
    p1 --> p2["2 · Core check"]:::done --> p3["3 · adapter-js<br/>+ examples"]:::done --> p4["4 · CLI<br/>check + init"]:::done
    p4 --> gate{{"Pilot on<br/>team repos"}}
    gate --> p5["5 · doctor"]:::done --> p6["6 · Templates<br/>+ sync"]:::done --> p7["7 · audit,<br/>progress, review"]:::done --> p8["8 · install"]:::done --> p9["9 · Docs +<br/>self-check"]:::done
    classDef done fill:#2e7d32,color:#fff,stroke:#1b5e20
```

Next: the pilot on the team's repos. Its feedback decides what stays, what gets simpler and what goes.

## Developing this repo

Requirements: Node ≥ 22, pnpm.

```bash
pnpm install
pnpm lint      # syntax, import boundaries, AGENTS.md rules, mermaid diagrams, package metadata
pnpm test      # every package + repo scripts (node:test)
pnpm self-check # this repo's own architecture, checked by its own reins check (and by dependency-cruiser alone)
pnpm pack:all  # tarballs in .tarballs/ to install in another repo
```

```
reins/
├── packages/
│   ├── core/            @agentreins/core        framework-agnostic: check, doctor, report, config, contract
│   ├── cli/             reins         the `reins` command
│   └── adapters/js/     @agentreins/adapter-js  Vite + React, Next; uses dependency-cruiser
├── templates/           files copied into consumer repos
├── examples/            vite-react (JS/JSX), next-app (TS): one test repo per preset
├── scripts/             lint.mjs, rename-scope.mjs, pack.mjs, self-check.mjs, verify/ (end-to-end scripts)
├── .reins/            this repo's own architecture.yml: cli > adapters > core
├── site/                landing page for GitHub Pages (plain HTML, no build step)
└── docs/                design, decisions, verification log, status, guides
```

How to contribute: [`CONTRIBUTING.md`](CONTRIBUTING.md). Rules for agents working here: [`AGENTS.md`](AGENTS.md). The repo checks its own architecture with its own `reins check`.

The landing page lives in `site/`: one static HTML file, no framework and no build step. `.github/workflows/pages.yml` deploys it to GitHub Pages on every push to main that touches `site/`. Enable it once in the repo: Settings → Pages → Source: "GitHub Actions"; the site is then served at `https://fredarcito.github.io/reins/`.

Renaming the npm scope: `pnpm rename-scope @new-scope --dry-run`, then without `--dry-run`, then `pnpm install`.

## Documentation

| Document | What's in it |
| --- | --- |
| [Project site](https://fredarcito.github.io/reins/) | The landing page, served by GitHub Pages; source in [`site/`](site/) |
| [`docs/walkthrough.md`](docs/walkthrough.md) | Full tour on an example app, with real output: install, init, a blocked commit, notes, doctor |
| [`docs/publishing.md`](docs/publishing.md) | How to publish the three packages to npm |
| [`docs/team-install.md`](docs/team-install.md) | Install in the team's repos without publishing; what goes in git; branch protection |
| [`docs/team-adoption.md`](docs/team-adoption.md) | The pilot: metrics, how to measure them, keep / simplify / drop; template [`docs/PILOT.md`](docs/PILOT.md) |
| [`docs/try-it.md`](docs/try-it.md) | Try `init` and `check` on a branch of your repo, without wiring anything |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Full design (Spanish draft, source of truth) |
| [`docs/architecture-yml.md`](docs/architecture-yml.md) | `architecture.yml` and `baseline.json` reference: keys, rules, globs, defaults |
| [`docs/adapter-contract.md`](docs/adapter-contract.md) | What a language adapter must implement |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | What is decided, build defaults, dependencies, open questions |
| [`docs/VERIFIED.md`](docs/VERIFIED.md) | What we tested about Claude Code, pnpm and dependency-cruiser, with evidence |
| [`docs/STATUS.md`](docs/STATUS.md) | Stable vs. experimental, and what is built |
| [`CHANGELOG.md`](CHANGELOG.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md) | Versions; how to contribute |

License: [MIT](LICENSE).
