# GitHub Pages site (2026-11-05)

| Topic | Decision | Why |
| --- | --- | --- |
| Landing page | `site/index.html`, one static file: vanilla HTML/CSS/JS, no framework, no build step | The page markets a no-lock-in, no-build-step tool; building it with a framework would contradict the message. Nothing new to maintain or update |
| Deployment | `.github/workflows/pages.yml`: official Pages actions (`configure-pages` / `upload-pages-artifact` / `deploy-pages`), on pushes to main touching `site/`, plus a manual trigger. Requires enabling Pages once (Settings → Pages → Source: "GitHub Actions") | The official flow needs no branch and no deploy key; a `gh-pages` branch and a `docs/` root were rejected — the first duplicates the source, the second would mix the landing page with the team's `docs/` and expose the markdown raw |
| Accuracy | Terminal output and rule texts on the page are quoted from the README and the core rule templates (`packages/core/src/check/rules/`), not invented | The page claims "same check locally and in CI"; showing fake output would undermine it |
