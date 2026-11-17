# Owned folders, second version (2026-11-05)

Running 0.5.1 on a real Next.js app (1204 files) showed the first version split features into pieces and assigned shared code.

| Topic | Decision | Why |
| --- | --- | --- |
| Never split a feature | Inside a folder organized by feature, a subfolder joins the domain that makes at least 2/3 of the imports into it, whole. The other imports become violations, frozen in the baseline and counted in the report | Requiring 100% made one import from another domain push the algorithm down a level, ending with `OverviewPage/content/**`, `OverviewPage/faq/**` and 100+ single files; a new file in `OverviewPage/` had no domain. Freezing a few imports is better than a plan nobody can read |
| "Organized by feature" | A folder's children are split among domains only when most of its used children are mostly used by one domain (`components/pages/`). Otherwise it is shared code and nothing in it is assigned (`components/shared/`) | A graph signal, not a name list: `components/shared/CircularProgress` used by one page today is still shared by intent, and its siblings say so |
| Layer roots | Directly under a layer root, a folder still needs every import from one domain | A layer root mixes everything (`components/` holding `Button`, `pages/`, `JobBoard/`), so it says nothing about intent |
| Lowest layer | Never assigned, folders or loose files | It is shared by design (`utils/vote.js`, `constants/dates.js` were assigned before) |
| AGENTS.md index | At most two paths per note, then `(+N more)` | The index is read on every session; one note listed ~150 paths |
| Preset shared layer | Adds `constants`, `store`, `api`, `context` (and `src/config`); not `providers` | Common low-level folders were left out of every layer (93 of 1204 files unchecked). Providers often import components, so a fixed layer would be wrong; the report proposes one from its imports instead |
| Unclassified folders | The report proposes the lowest layer each one fits without violations, from who imports it and what it imports | Turns a list of unchecked folders into a decision a person can take in seconds |
