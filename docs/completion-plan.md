# Completion Plan

Status: **in progress — A1 + A2 (durable persistence + portable dataset) landed; B1 next**
Date: 2026-06-27 (last updated 2026-06-27)
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

- **B2 — Whole-file import flow (multiple teams).**
  Let the readiness report drive importing all ready teams in a file at once (the
  per-team engine already exists via the readiness report), with the existing
  needs-review / blocked rows surfaced for decisions.
  - *Acceptance:* A full scraped season file can be imported in one guided pass; blocked
    rows are clearly explained, not silently dropped.

### Workstream C — District registry + maintenance utility

- **C1 — District registry data model + persistence.**
  Define the canonical district record (id, display name, mascot, primary/secondary
  color, helmet image filename, logo image filename) and store it in the persisted
  workspace. Seed it with the known Ute Conference districts.
  - *Acceptance:* Registry persists across restarts; known districts resolve to `high`
    confidence instead of `provisional`.

- **C2 — District Maintenance screen.**
  An in-app utility to list, add, edit, and inactivate districts; set name/mascot/colors;
  and point a district at helmet/logo files in `public/districts/`. Districts are never
  destructively deleted — inactivate (not remove) is the only way to retire one.
  - *Acceptance:* Owner can add a brand-new district with a helmet image and see it used
    in the app, with no code changes.

- **C3 — Wire registry into import mapping + confirm-on-import.**
  Feed the registry into the scraped-JSON canonical mapping so registered districts stop
  warning, and when an import hits an unknown district, prompt to confirm/add it once
  (then it's remembered).
  - *Acceptance:* The "provisional district" warning disappears for registered
    districts; new districts can be confirmed during import.

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
- **E2 — File-error handling.** Clear, plain-language messages for malformed or
  wrong-shape JSON files instead of silent failure.
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
- [x] **A2** — One-click portable export/import + save indicator (round-trip test) · branch: `milestoneA2-portable-dataset-export-import` · PR: _pending_ · landed 2026-06-27
- [ ] **B1** — Commit a previewed scraped-JSON team into the workspace (with undo) · PR: _ · _
- [ ] **C1** — District registry model + persistence (seed Ute Conference districts) · PR: _ · _
- [ ] **C3** — Wire registry into import mapping + confirm-on-import (clears provisional warning) · PR: _ · _

**Milestone 2 — "Full data in, fully managed"**
- [ ] **B2** — Whole-file import flow (multiple teams from readiness report) · PR: _ · _
- [ ] **C2** — District Maintenance screen (add/edit/inactivate, point at helmet/logo files) · PR: _ · _
- [ ] **E1** — First-run + empty states · PR: _ · _
- [ ] **E2** — File-error handling (malformed/wrong-shape JSON) · PR: _ · _

**Milestone 3 — "Roadmap complete"**
- [ ] **D1** — District branding artwork in views · PR: _ · _
- [ ] **D2** — Coach Scout-to-Scout continuous-cohort exception · PR: _ · _
- [ ] **D3** — My Team favorites persistence + opponent profile links · PR: _ · _
- [ ] **D4** — Surface transient import-workbench review rows in Review Center · PR: _ · _
- [ ] **E3** — Launcher wait-for-server polish · PR: _ · _
- [ ] **E4** — Full regression pass (`npm test`, `npm run build`) + smoke test · PR: _ · _

## Next slice

**Slice A1 (IndexedDB persistence).** It is the foundation every other usable feature
relies on, reuses your existing snapshot code, and immediately fixes the most painful
gap (data not surviving a restart). No open questions remain — ready to start.
