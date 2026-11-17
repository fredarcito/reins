# Thin routes in `init`, notes of new domains (2026-11-09)

First real run on a Vite repo whose routes are one `index.jsx` each and whose code lives in `components/pages/<x>` (repvue-employer): 3 domains out of 26 route folders, and `/reins-arch` then added 13 domains with no notes and no warning.

| Topic | Decision | Why |
| --- | --- | --- |
| One-file routes | Every route folder competes in `inferOwnedFolders`; only afterwards are one-file routes that own nothing left out | Dropping them first threw away the modules whose route is thin (3 → 14 domains on that repo) |
| Routes sharing a feature folder | Small routes are merged into one domain when a folder right inside a container organized by feature is imported only by them, by two or more (`mergeSmallRoutes`); the domain takes the folder's name | `notifications` + `notificationsPreferences` over `components/pages/notifications/`. Graph only: grouping by a shared `api/auth` file would depend on names and the lowest layer, so the `arch` skill proposes those groups instead, and a person decides |
| Notes of new domains | `doctor` flags `note-missing` for every domain without a note whenever `architecture.yml` changed, at any level; the `arch` skill drafts the notes of the domains it adds | Before, `note-missing` needed changed code in the domain, so domains added to the plan never got a note |
