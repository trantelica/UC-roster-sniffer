# UC Roster Sniffer

UC Roster Sniffer is a local-first roster intelligence tool for tracking youth football roster movement across seasons, districts, age divisions, teams, players, coaches, schedules, and results.

## Core purpose

The application helps answer:

- Who returned to a roster from the prior season?
- Who is new, transferred, promoted, relegated, y-up, or z-down?
- How did teams and coaches perform over time?
- How stable is a district, age division, team, or coaching cohort year over year?

## Working philosophy

This project should be built from specifications first. The docs in `docs/` are the governing source for requirements, data structure, derived logic, import behavior, UI flow, and build sequencing.

## Running it locally

```bash
npm install
npm run dev
```

Other scripts: `npm test` (Vitest), `npm run build` (type-check + Vite build), `npm run preview`.

The app is local-first: no backend, no authentication, no cloud database. The workspace auto-saves to this browser via IndexedDB and auto-restores on startup; a full-dataset JSON export is the portable backup/handoff path.

## Structure

```text
docs/
  product-requirements.md
  data-model.md
  derived-logic.md
  import-workflow.md
  ui-workflow.md
  design-system.md
  build-roadmap.md
  implementation-plan.md
  completion-plan.md

data-samples/
  district-config.sample.json
  roster-import.sample.json
  roster-import-2025.sample.json
  schedule-import.sample.json
  coach-import.sample.json
  games.sample.json
  ute-conference-seed.sample.json

src/
  domain/      domain types
  engine/      pure deterministic logic (filtering, comparison, identity, import planning)
  storage/     IndexedDB workspace persistence + snapshot repositories
  components/  React display + interaction
  app/         application shell
  design/      design tokens
  data/        bundled sample/fixture data
  test/        Vitest suites and fixtures
```

## Current status

Build-roadmap Phases 1–10 (engine + read-only UI) are complete and merged. The active plan is `docs/completion-plan.md`, which brings the tool to daily-usable completion.

- **Milestone 1 — "It's a real tool"** (complete): IndexedDB persistence, portable dataset export/import, per-team scraped-JSON commit, district registry wired into import mapping.
- **Milestone 2 — "Full data in, fully managed"** (complete): whole-file player import, District Maintenance screen (add / edit / inactivate / reactivate — districts are never deleted), first-run and empty states, plain-language file-error handling. Later corrections added flat-source normalization, parenthetical district routing, and whole-file coach import.
- **Milestone 3 — "Roadmap complete"** (in progress): district branding artwork in views, the coach Scout-to-Scout exception, My Team favorites and opponent links, Review Center import rows, then launcher polish and a full regression pass.

See `docs/completion-plan.md` for the live progress tracker, locked decisions, and the next slice.
