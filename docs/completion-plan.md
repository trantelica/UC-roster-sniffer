# Completion Plan

Status: **in progress — A1 + A2 + B1 + C1 + C3 + B2 + C2 + E1 + E2 (persistence, portable dataset, scraped-JSON team commit, district registry + registry-backed import mapping, whole-file player import, District Maintenance screen, first-run/empty states, plain-language file-error handling) landed; Milestone 2 complete — Milestone 3 (D1–D4, E3, E4) next**
Date: 2026-06-27 (last updated 2026-06-28)
Owner: product owner (novice vibe coder)

> **Live document.** Update the [Progress tracker](#progress-tracker) as each slice
> lands (check it off, record the PR). Keep the `CLAUDE.md` "Current development status"
> section in sync at each milestone.

## Purpose

The engine and read-only UI for Phases 1–10 are built and merged. But the tool is
**not yet usable for real work** because:

1. **Nothing persists.** All data lives in memory. Closing the terminal or reloading
   the page wipes it, so every session starts empty.
2. **Imports do not commit.** The scraped-JSON screen is a *read-only preview*. You
   can see how a file was interpreted, but you cannot get that data **into** the tool
   to then browse, filter, and analyze.
3. **No district registry.** Districts fall back to a "provisional" placeholder
   (the warning the owner hit), and there is no way to manage districts or their
   helmet/logo artwork.

This plan brings the tool to **completion = a daily-usable local app**: load real
scraped data, commit it, have it stay in the tool across restarts, manage districts
and artwork, and finish the remaining roadmap polish.

This document is additive. It does not replace any existing spec. Where it extends a
phase, it references the canonical docs.

## Decisions locked (negotiated 2026-06-27)

| Topic | Decision |
|-------|----------|
| Scope | **Full roadmap.** Complete everything, including the deferred polish (district artwork, coach Scout-to-Scout exception, favorites, opponent links). |
| Primary import path | **Scraped Ute Conference JSON**, taken end-to-end (load → review → commit → persist → view). Paste/CSV stays available but secondary. |
| Districts | **Build a District Maintenance utility.** A small in-app screen to add/edit/inactivate districts over time, set name/mascot/colors, and point each at helmet `.jpg`/`.png` files stored in a project folder. **Districts are never destructively deleted** — they may be edited or marked inactive only. |
| Persistence | **IndexedDB (confirmed)** for automatic session-to-session storage — data stays in the tool across terminal/browser/Mac restarts with no manual load. **Plus a hard requirement:** a one-click full-dataset JSON export that is completely portable and round-trips back into another person's browser (give the file to another coach/assistant → they import → identical workspace). No backend for now; a local-file backend stays a possible later upgrade only. |

## Persistence: what "data stays in the tool" actually requires

Today the tool keeps everything in **memory (RAM)**. When the dev server stops or the
page reloads, that memory is cleared — that is exactly why you must re-load every
session. To make data persist we need a **durable store that lives outside that
memory**. Two local-first options, both no-cloud:

### Option 1 — Browser storage (IndexedDB) — *recommended starting point*
The browser keeps a small private database on disk, tied to this app. We **auto-save**
the whole workspace on every change and **auto-load** it when the app opens.

- ✅ Survives closing the terminal, closing the browser, and restarting the Mac.
- ✅ No backend, no new process — fits the current architecture posture.
- ✅ **Reuses code you already have:** `buildWorkspaceSnapshot` already serializes the
  entire workspace to JSON and `restoreWorkspaceFromSnapshot` reads it back. We write
  that same JSON to IndexedDB instead of a manual file. Low risk.
- ⚠️ Tied to the specific browser you use. If you manually clear that browser's site
  data, or switch browsers, the data isn't there. **Mitigation:** keep the existing
  JSON export as a one-click backup/restore safety net (already built).

### Option 2 — Local file via a tiny backend — *optional upgrade*
The app writes a real `workspace.json` (or SQLite) file **inside the project folder**.

- ✅ Truly portable: copy the project folder and the data comes with it.
- ✅ Survives browser changes entirely.
- ⚠️ Introduces a small local server process. The launcher already runs a server for
  Vite, so this is incremental — but it does cross the "no backend" line in the specs,
  which is why it needs explicit approval.

### Decision (confirmed 2026-06-27)
**Option 1 — IndexedDB — is approved**, on the condition that the **full-dataset JSON
export stays completely portable and round-trips into another person's browser**. That
condition is already met by the existing `buildWorkspaceSnapshot` (writes the entire
workspace) and `restoreWorkspaceFromSnapshot` (validates + replaces) pair; Slice A2
makes it a one-click action and verifies the round-trip with a test. The snapshot
format is identical to what a future local-file backend would use, so Option 2 remains
a clean drop-in upgrade if copy-the-folder portability is ever wanted — no rework.

## Helmet / logo artwork: how files are stored

Helmet and logo images are static files. We add a project folder — `public/districts/`
— where you drop your `.jpg`/`.png` files (Vite serves anything in `public/`
automatically). The District Maintenance screen lets you pick/point a district at a
filename (e.g. `alta-helmet.png`), and the app references it from there. This works
with either persistence option. Your image files live with the project; only the
*reference* (which file belongs to which district) is stored in the workspace data.

## Sequenced plan

Work proceeds in the project's established style: small, reviewable slices, one feature
branch + one PR each, `npm test` and `npm run build` green before completion, no
future-phase behavior pulled early. Slices are grouped into workstreams. **Order is
chosen so the tool becomes usable as early as possible** (Workstreams A–C), then
finishes the roadmap (D) and hardens (E).

### Workstream A — Durable persistence (the foundation)

- **A1 — Persistence store + auto-save/auto-load (IndexedDB).**
  Add a persistence boundary that, on every workspace change, writes the
  `buildWorkspaceSnapshot` output to IndexedDB, and on app startup restores it via
  `restoreWorkspaceFromSnapshot`. Reuses existing serialization; no schema changes.
  Keep the IndexedDB read/write isolated behind a small module so it stays testable and
  swappable.
  - *Acceptance:* Import or change data, fully close the terminal, re-run the launcher,
    reopen the app — the data is still there with no manual load.
  - *Keeps:* existing manual JSON export/import untouched as the portable backup path.
  - **Landed (2026-06-27).** Module `src/storage/workspaceIndexedDbStore.ts` (DB
    `uc-roster-sniffer` v1, store `workspace`, single record `active-workspace` holding
    `{ id, persistenceVersion: 1, savedAt, snapshot }`). App auto-loads on startup and
    debounced-auto-saves (~700ms) on workspace-data change, with a save-state indicator.
    **Boundary B1 must respect:** auto-save persists the *committed* `workspace`, **not**
    the transient `inMemoryImport` overlay — so persistence does not silently commit a
    previewed import. When B1 makes scraped-JSON import commit into `workspace`, it will
    auto-persist for free. Corrupt/unsupported records surface a calm warning and are
    never auto-deleted. No `localStorage`.

- **A2 — One-click portable export/import + save-state indicator.**
  Surface a clearly labeled **Export Dataset (.json)** and **Import Dataset** pair plus
  a small "Saved" / "Saving…" indicator.
  - *Acceptance (hard requirement):* The exported `.json` contains the **entire**
    dataset and **round-trips completely** — importing it into a *different* browser /
    on a *different* machine reproduces an identical workspace (the "hand a file to
    another coach" test). Covered by an automated round-trip test
    (`build → export JSON → parse → restore` yields equivalent workspace data) in
    addition to a manual cross-browser check.
  - *Acceptance:* Owner can see data is saved at a glance.
  - **Landed (2026-06-27).** Toolbar now reads **Export Dataset (.json)** / **Import
    Dataset (.json)** with copy distinguishing browser auto-save (this machine) from the
    portable file. **Export uses the committed `workspace` only** (never the transient
    `inMemoryImport` overlay); when an overlay is active the copy says the preview is not
    included. Import goes through `parseWorkspaceSnapshotJson` + `restoreWorkspaceFromSnapshot`
    (replace, never merge), clears the overlay, and auto-saves via A1. The imported summary
    now includes coaches. Automated round-trip proof in
    `src/test/workspaceDatasetRoundTrip.test.ts` (export JSON → parse → restore → re-export
    yields canonically equivalent workspace data, ignoring only the volatile timestamp). No
    second export format; no import commit.

### Workstream B — Make scraped-JSON import actually commit (end-to-end)

- **B1 — Commit a previewed scraped-JSON team into the workspace.**
  Turn the read-only preview into a real action: "Import these rows" that runs the
  existing in-memory execution helpers (`uteConferenceScrapedJsonImportExecution`)
  into the workspace, with undo. Combined with A1, the result auto-persists.
  - *Acceptance:* Load the coaches/players JSON you were testing, click commit, and see
    that team and its coaches/players appear in the normal viewer — and still be there
    after a restart.
  - **Landed (2026-06-28).** A **Commit Import to Workspace** action in the import
    workbench writes the staged, ready **player** team (the existing execution helper's
    `executedTeam`: existing records preserved + planned additions appended) into the
    committed `workspace` via the new pure helper `src/engine/workspaceImportCommit.ts`.
    It is gated by the same readiness gate as the in-memory preview, so unresolved /
    blocked / needs-review / missing-context targets cannot be committed. Commit
    auto-saves via A1 and is included by A2 Export Dataset; a session-only **Undo
    Committed Import** restores the exact pre-commit team. The transient in-memory overlay
    is cleared on commit. **Coach scraped-JSON commit is deferred** — the execution helper
    only commits player roster teams, and a coach commit needs a new engine (next slice).

- **B2 — Whole-file import flow (multiple teams).**
  Let the readiness report drive importing all ready teams in a file at once (the
  per-team engine already exists via the readiness report), with the existing
  needs-review / blocked rows surfaced for decisions.
  - *Acceptance:* A full scraped season file can be imported in one guided pass; blocked
    rows are clearly explained, not silently dropped.
  - **Landed (2026-06-28). Superseded by the PR #72 corrections** (see "Corrections (PR #72)"
    below): roster import now plans **create / update / blocked** per target and **creates**
    missing teams — it no longer skips no-existing-team targets, and "Commit All Ready Teams"
    became **Commit roster import**. The note below describes B2's original update-only batch.
    A **Whole-file player import** panel evaluates every
    player-team target in the loaded file by COMPOSING the exact single-target pipeline
    (session select → roster-aware review → staged projection → future readiness →
    transaction plan → execution) with EMPTY review decisions, so a team is committable only
    when the pipeline already calls it ready without manual review. Two batch-only safety
    gates layer on top (never replacing the pipeline): a non-high-confidence/unregistered
    district skips the team (`provisional-district`) until confirmed (C3), and two targets
    resolving to the same workspace team skip the later one (`duplicate-target`). Coach
    targets and targets with no existing workspace team are skipped. **Commit All Ready Teams
    to Workspace** executes all committable teams ALL-OR-NOTHING (`executeWholeFilePlayerImportBatch`)
    and writes them in one workspace transform (`commitImportedTeamsToWorkspace`); a failure
    applies nothing. Auto-saves via A1, exported by A2. Session-only **Undo Whole-file Import**
    (`undoImportedTeamsCommitInWorkspace`) restores every affected team, preserving unrelated
    later changes. Engine: `src/engine/uteConferenceScrapedJsonWholeFileImport.ts`. B1
    single-team commit and C3 confirm/add still work. No coach commit, no new team creation,
    no multi-file import.

### Workstream C — District registry + maintenance utility

- **C1 — District registry data model + persistence.**
  Define the canonical district record (id, display name, mascot, primary/secondary
  color, helmet image filename, logo image filename) and store it in the persisted
  workspace. Seed it with the known Ute Conference districts.
  - *Acceptance:* Registry persists across restarts; known districts resolve to `high`
    confidence instead of `provisional`.
  - **Landed (2026-06-28).** The workspace `districts` collection IS the registry (no second
    system). `District` gained optional `status` (`active`/`inactive`; absent = active),
    optional `sourceLabels` (exact scraped-label aliases), and optional `brandingProvisional`
    (placeholder branding flag). Pure helpers in `src/engine/districtRegistry.ts`
    (coerce/validate, seed, ensure-without-duplicates, find active/inactive/by-id/by-exact-name,
    build name→id lookup, confirm-unknown, inactivate — **no hard-delete**). Deterministic seed
    in `src/data/districtRegistrySeed.ts` (Alta, Brighton — reusing repo branding, not invented).
    Snapshot copy/validation carry the new fields; older snapshots without `status` restore as
    active and round-trip unchanged. Auto-save (A1) and Export/Import (A2) carry the registry
    naturally. Image references stay plain string paths (no bytes). Districts are never deleted.

- **C2 — District Maintenance screen.**
  An in-app utility to list, add, edit, and inactivate districts; set name/mascot/colors;
  and point a district at helmet/logo files in `public/districts/`. Districts are never
  destructively deleted — inactivate (not remove) is the only way to retire one.
  - *Acceptance:* Owner can add a brand-new district with a helmet image and see it used
    in the app, with no code changes.
  - **Landed (2026-06-28).** A **Districts** tab (`src/components/DistrictMaintenanceView.tsx`)
    lists every district (active AND inactive — inactive never hidden) with name, id, mascot,
    status, color chips, logo/helmet path refs, `brandingProvisional` flag, and source-label
    aliases. The user can **add** a district (deterministic id from the name slug, collision-
    disambiguated; never typed by hand; `sourceLabels` default to `[name]`; status active),
    **edit** mutable fields (id and status never change on edit), **inactivate**, and
    **reactivate** (same id preserved) — there is **no delete**. New pure helpers in
    `districtRegistry.ts`: `createDistrictFromInput`, `updateDistrict`, `reactivateDistrict`,
    `validateDistrictInput`, `normalizeSourceLabels`, `isDistrictReferencedByTeams`,
    `countTeamsForDistrict` (no delete/remove/destroy export). All changes write committed
    `workspace.districts`, so A1 auto-saves, A2 export/imports, and C3/B2 import mapping uses
    active edits/creates/reactivations immediately. Image handling is string references only
    (no upload/file picker). Inactivating a referenced district is allowed with a warning;
    existing rosters keep their districtId and stay valid.

- **C3 — Wire registry into import mapping + confirm-on-import.**
  Feed the registry into the scraped-JSON canonical mapping so registered districts stop
  warning, and when an import hits an unknown district, prompt to confirm/add it once
  (then it's remembered).
  - *Acceptance:* The "provisional district" warning disappears for registered
    districts; new districts can be confirmed during import.
  - **Landed (2026-06-28).** The import workbench builds an exact-name lookup from the
    **active** workspace registry (`buildDistrictNameRegistryLookup`) and passes it as the
    existing `districtRegistry` option into the import session, so a registered district
    resolves at `high` confidence with no `district-mapping-provisional` issue. Matching is
    EXACT only (name or `sourceLabels`); active matches beat inactive; distinct names
    ("Bingham" vs "Bingham Girls") are never collapsed. A provisional district shows an **Add
    district to registry** action that calls `confirmUnknownScrapedDistrict` into committed
    workspace state (auto-saved via A1); the workbench re-derives reactively (district prop
    change — no remount, loaded source preserved) so the district is no longer provisional.
    The full **District Maintenance** screen (edit branding, pick images, inactivate) remains
    C2.

### Workstream D — Remaining roadmap polish (full-scope completion)

- **D1 — District branding artwork in views.** Render helmets/logos/colors/mascot in
  team and standings views (Phase 9 leftover; artwork now exists via C).
- **D2 — Coach Scout-to-Scout continuous-cohort exception** (Phase 7 leftover).
- **D3 — My Team favorites persistence + opponent profile links** (Phase 8 leftover;
  now persistable via A).
- **D4 — Surface transient import-workbench review rows in the Review Center**
  (Phase 10 leftover).

### Workstream E — Usability hardening

- **E1 — First-run + empty states.** Friendly empty/onboarding states so a fresh,
  data-less app explains what to do (import a file) instead of looking broken.
  - **Landed (2026-06-28).** Pure helper `assessWorkspaceEmptiness` /
    `recommendedFirstRunActions` (`src/engine/workspaceEmptyState.ts`) drives a first-run
    state: when the workspace has no teams, the Roster tab shows a calm explainer (local-only,
    auto-saves here, nothing uploaded) with next-action buttons — **Go to Roster import**,
    **Import Dataset**, **Manage Districts** — via existing view switching (no routing, no
    wizard). My Team gains a no-teams state with a Roster-import CTA. A reusable presentational
    `EmptyState` component carries the pattern. The bundled sample data (which has teams) is
    not treated as empty.
- **E2 — File-error handling.** Clear, plain-language messages for malformed or
  wrong-shape JSON files instead of silent failure.
  - **Landed (2026-06-28).** Pure `classifyImportFileShape` (`src/engine/importFileShape.ts`)
    + `buildDatasetImportErrorGuidance` / `buildScrapedImportErrorGuidance`
    (`src/app/fileImportGuidance.ts`) translate the existing deterministic validators (never
    loosened) into a Title / “What happened” / “Try this” (+ optional technical detail)
    structure. Dataset Import and Roster import each show this, and detect a file that belongs
    in the OTHER path (scraped file → Roster import; dataset export → Import Dataset) plus
    unsupported record type, empty file, invalid JSON, and wrong shape. A coaches file in the
    Roster workbench notes that whole-file import is player-only. No engine code names as the
    headline; validation logic unchanged.
- **E3 — Launcher polish.** Optional: have the `.command` launcher wait for the server
  before opening the browser (removes the brief "can't connect" flash).
- **E4 — Full regression pass.** Confirm `npm test` and `npm run build` green; smoke-test
  the full load → import → persist → restart → view loop.

## Suggested milestones

- **Milestone 1 — "It's a real tool."** A1, A2, B1, C1, C3.
  Outcome: load real scraped data, commit it, districts resolve, data survives restart.
- **Milestone 2 — "Full data in, fully managed."** B2, C2, E1, E2.
  Outcome: import whole season files; manage districts and artwork; friendly errors.
- **Milestone 3 — "Roadmap complete."** D1–D4, E3, E4.
  Outcome: all deferred polish done; final regression + build green.

## Non-goals / guardrails (unchanged)

- No cloud database, no authentication. (Local-file backend in Option 2 is *local only*
  and only if explicitly approved.)
- Persistence does not auto-sync anywhere off the machine.
- Loaded roster records stay authoritative; derived metadata never mutates source rows.
- Prior seasons stay locked.
- No reshaping of existing sample-data contracts.
- **Districts must never be destructively deleted.** District Maintenance (Workstream C)
  may add, edit, or mark a district inactive only — never remove/hard-delete a district
  record. This is a locked rule for all current and future slices.

## Progress tracker

All decisions are settled; no blockers. Work the slices top-to-bottom. When a slice
lands, change `[ ]` to `[x]` and fill in the PR/branch + date so a new session can pick
up exactly where the last one stopped.

**Milestone 1 — "It's a real tool"**
- [x] **A1** — IndexedDB persistence (auto-save / auto-load) · branch: `milestoneA1-indexeddb-workspace-persistence` · PR: #65 · landed 2026-06-27
- [x] **A2** — One-click portable export/import + save indicator (round-trip test) · branch: `milestoneA2-portable-dataset-export-import` · PR: #66 · landed 2026-06-27
- [x] **B1** — Commit a previewed scraped-JSON team into the workspace (with undo) · branch: `milestoneB1-scraped-json-team-commit` · PR: #67 · landed 2026-06-28
- [x] **C1** — District registry model + persistence (seed Ute Conference districts) · branch: `milestoneC1C3-district-registry-import-mapping` · PR: #68 · landed 2026-06-28
- [x] **C3** — Wire registry into import mapping + confirm-on-import (clears provisional warning) · branch: `milestoneC1C3-district-registry-import-mapping` · PR: #68 · landed 2026-06-28

**Milestone 2 — "Full data in, fully managed"**
- [x] **B2** — Whole-file import flow (multiple teams from readiness report) · branch: `milestoneB2-whole-file-player-import` · PR: #69 · landed 2026-06-28
- [x] **C2** — District Maintenance screen (add/edit/inactivate, point at helmet/logo files) · branch: `milestoneC2-district-maintenance-screen` · PR: #70 · landed 2026-06-28
- [x] **E1** — First-run + empty states · branch: `milestoneE1E2-first-run-empty-file-errors` · PR: #71 · landed 2026-06-28
- [x] **E2** — File-error handling (malformed/wrong-shape JSON) · branch: `milestoneE1E2-first-run-empty-file-errors` · PR: #71 · landed 2026-06-28

**Milestone 3 — "Roadmap complete"**
- [ ] **D1** — District branding artwork in views · PR: _ · _
- [ ] **D2** — Coach Scout-to-Scout continuous-cohort exception · PR: _ · _
- [ ] **D3** — My Team favorites persistence + opponent profile links · PR: _ · _
- [ ] **D4** — Surface transient import-workbench review rows in Review Center · PR: _ · _
- [ ] **E3** — Launcher wait-for-server polish · PR: _ · _
- [ ] **E4** — Full regression pass (`npm test`, `npm run build`) + smoke test · PR: _ · _

**Corrections (PR #72 — post-Milestone-2, before merge)**
- [x] **Robust scraped-source normalization** — accept a flat player/coach row-list in addition
  to nested scraped JSON (normalize to the nested shape; names preserved exactly).
- [x] **District Maintenance panel** — add/edit form opens on demand (not always-open).
- [x] **Empty default startup** — fresh workspace is empty (no teams), with the **39 known Ute
  Conference districts** + fixed age divisions seeded by default; **Reset workspace** /
  **Load sample data** / optional **Load Ute Conference seed** actions.
- [x] **Roster import creates teams** — corrected model: import plans **create / update /
  blocked** per target and commits on explicit action (`commitRosterImportToWorkspace`); the
  Ute Conference team-seed path is **optional / non-primary**.
- [x] **Materialized-team selector** — the Team selector shows only teams populated by committed
  data, not empty/seed shells (fixes the Corner Canyon "0 players / 17 prior" symptom).

## Next slice

**Milestones 1 and 2 are complete** (A1, A2, B1, C1, C3, B2, C2, E1, E2): scraped data loads,
commits per-team or whole-file, persists across restarts; districts are fully managed in-app
(add / edit / inactivate / reactivate, never deleted) and feed import mapping immediately; and
the app now has first-run/empty-state guidance plus plain-language file-error handling. The
remaining work is **Milestone 3 — "Roadmap complete":** **D1** (district branding artwork in
team/standings views — builds directly on the C2-managed branding), **D2** (coach
Scout-to-Scout continuous-cohort exception), **D3** (My Team favorites persistence + opponent
profile links), **D4** (surface transient import-workbench review rows in the Review Center),
then **E3** (launcher wait-for-server polish) and **E4** (full regression + smoke test). D1 is
the natural next slice.
