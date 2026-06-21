# UI Workflow

This document defines the initial user experience model.

## Primary navigation

The primary navigation path is:

```text
Season -> District -> Age Division -> Team
```

Each selection narrows the analytical scope.

## Default season selection

When loaded data includes multiple seasons, the app should default to the most recent season.

- This matches the normal expectation that the current/latest season is the first view.
- Prior-season data remains available for derived comparison, but a prior season should not become the default landing state unless the user explicitly selects it.

## No-team-selected summary view

When the user has selected season, district, and/or age division but has not selected a specific team, the app should show derived summaries based on the active filters.

### Example summary metrics

Team composition:

- team count
- count by team level

Player composition:

- total players
- returning players
- new players
- transfers
- y-ups
- z-downs
- promotions
- relegations

Coach composition:

- returning coaches
- continuous-cohort coaches

## Team selected view

When a team is selected, the app should display:

- team composition summary
- in-year performance summary
- head coach card
- assistant coach cards
- player cards

## Team composition summary

The team composition summary should show current roster makeup relative to the prior season.

Initial metrics:

- total players
- returning player count
- new player count
- transfer count
- y-up count
- z-down count
- promoted count
- relegated count

### Prior-season comparison summary panel (Phase 3)

The selected team view includes a read-only prior-season comparison summary panel
derived from the Phase 3 comparison pipeline
(`comparePriorSeasonRoster` -> `summarizePriorSeasonRosterComparison`).

When a prior-season same-slot team exists, the panel shows these derived counts:

- Returning
- New to roster
- Not returning
- Unknown current
- Unknown prior
- Total current
- Total prior
- High confidence
- Low confidence

Rules:

- The panel is read-only and non-interactive. It displays derived counts only and
  never alters, removes, suppresses, merges, reorders, or hides any roster record.
- Returning is counted once per current player, never double-counted across the
  current and prior sides.
- Not-returning is a prior-season summary count only; prior-only players are never
  rendered as current player cards.
- When no prior-season same-slot team is available, the panel shows a clear
  unavailable state instead of fabricated zero counts.
- This panel is additive and does not replace the existing roster-status summary.

## Team performance summary

The team performance summary should show:

- current record
- win percentage
- prior-year record
- playoff status
- championship status
- schedule summary

## Cards

Cards should exist for:

- head coach
- assistant coaches
- players

Cards should communicate roster or coaching context visually.

## Player card visual status

Supported roster status indicators:

- Returning
- New
- Transfer
- Y-Up
- Z-Down
- Promoted
- Relegated
- Low Confidence

The UI should distinguish between the roster status and identity-confidence warnings.

### Current roster player-card status (Phase 2)

Current selected-team player cards may show a small derived status badge based on
exact prior-season identity comparison. Only these values appear on a current
roster card:

- Returning — an exact current/prior identity match.
- New — a current-only player with no prior-season identity match.
- Unknown — an ambiguous (duplicate-name) current player; identity confidence is
  low, but the player record still displays.

Rules:

- `Not returning` belongs in summary/comparison context, not on current roster
  player cards. Not-returning players are prior-season players absent from the
  current roster, so they are never rendered as current player cards.
- Ambiguous or duplicate current players remain individually visible and display
  `Unknown`; ambiguity affects derived metadata only and never hides, merges, or
  rewrites a rostered player record.
- When prior-season comparison is unavailable, current player cards display no
  per-player status badge and the full roster still renders.

Derived status is display metadata only and never mutates the player object.

### Roster status vs. identity-confidence warning (Phase 2)

Roster status and identity confidence are two separate visual signals on a
player card. They must not be merged into one overloaded badge.

- The roster status badge answers: Returning / New / Unknown.
- The identity-confidence warning answers: this identity match needs review
  because derived confidence is low.

A current player card may show both at once: the roster status badge plus, when
derived confidence is low, a distinct identity-review warning (for example
`Identity review`).

Rules:

- The low-confidence identity warning is a review indicator only. It does not
  alter, hide, reorder, merge, or remove any roster record. Loaded roster
  records remain authoritative; ambiguity affects derived metadata only.
- High-confidence current players (exact returning matches, current-only new
  players) show no identity-review warning.
- When prior-season comparison is unavailable, no derived confidence exists, so
  no identity-review warning appears and the full roster still renders.
- Ambiguous (duplicate-name) current players each remain individually visible
  and each may show the warning.

## Coach cards

Coach cards should support summary signals such as:

- returning coach
- new coach
- continuous-cohort coach
- lifetime record
- current team record

## Detail side panel

Selecting a card opens a side panel.

### Player side panel

Show:

- full historical team assignments
- historical districts
- historical age divisions
- historical roster classifications
- notes
- identity confidence details, if applicable

Full detail should be shown unless performance degrades.

### Coach side panel

Show:

- coaching history
- team assignments
- lifetime record
- continuous-cohort record
- championship history

## District branding

When a district is selected, district branding may influence the UI.

District branding fields:

- logo
- helmet
- mascot
- primary color
- secondary color

Potential applications:

- page header
- card accents
- badges
- team summary panels
- coach and player cards

Exact application is intentionally open for later design.

## Age division visual language

Age divisions should have distinct visual treatment.

Possible mechanisms:

- badge styles
- color families
- labels
- icons

## Team-level visual language

Team classifications should have distinct visual treatment.

Examples:

- A-team indicators
- B-team indicators
- C-team indicators
- D-team indicators
- competitive tier markers

## My Team panel

Users should be able to mark a team as `My Team` for a specific season.

The app should include a collapsible left-side panel for My Team.

Panel content:

- schedule
- upcoming games
- results
- opponent links

Opponent entries should navigate to the corresponding opponent team profile.

## Cohort reclassification UI (Phase 4 checkpoint)

Phase 4 (cohort reclassification preservation) is checkpointed and is **engine-only
— it adds no UI** (see `docs/derived-logic.md`, "Phase 4 checkpoint"). Through
Phase 4 there are:

- no y-up / z-down player-card badges;
- no manual cohort review screen;
- no wiring of derived cohort assignments, review actions, decisions, or the
  decision repository into React state.

`resetRecommended` and an accepted `reset` are advisory / recorded only; nothing in
the UI performs a reset. Rendering cohort status and a manual review screen are
future work, layered on top of the existing engine when approved.

## Import pipeline UI (Phase 5 checkpoint)

Phase 5 slices 1–6 (import preview, identity match candidates, the review
action/decision contract, the decision repository, effective decision application,
and the dry-run commit preview plan) are checkpointed and are **engine-only — they
add no UI** (see `docs/derived-logic.md`, "Phase 5 checkpoint"). Through Phase 5 so
far there are:

- no import preview, identity match, or collision review screens;
- no controls to accept / reject / manually link / create-new;
- no commit or dry-run plan UI;
- no wiring of preview rows, match entries, review decisions, the decision
  repository, applied outcomes, or the commit preview plan into React state.

`ready-to-link` / `ready-to-create` plan rows are future intended operations only;
nothing in the UI performs an import apply / commit, and a high-confidence single
candidate is never auto-linked. Rendering the collision review and commit screens is
future work, layered on top of the existing engine when approved.

Slices 9–12 add engine-only ingestion for harvested data — a pasted-text/CSV parser
(slice 9), a Ute Conference scraped-JSON source adapter (slice 10), canonical
source-label mapping (slice 11), and a full-file **readiness report** (slice 12). None
of these add UI. A future import screen could consume
`createUteConferenceScrapedJsonReadinessReport` to drive team selection: it exposes,
per team, a `readinessStatus` (`ready` / `ready-with-warnings` / `needs-review` /
`blocked` / `empty`), human-readable reasons, and summary gates
(`canProceedToTeamSelection`, `canProceedWithoutReview`). That UI remains future work,
gated on explicit approval; the report itself reads source data only and mutates
nothing.

### Scraped JSON import session state (Phase 5 slice 14)

Slice 14 adds an engine-only, in-memory **import session state model** for one scraped
JSON source file (`src/engine/uteConferenceScrapedJsonImportSession.ts`) that is
**intended for future UI consumption** but **adds no UI itself**. It composes the
slice 12 readiness report with target selection, canonical mapping, and preview
outputs into one deterministic session object. A future import screen could:

- load a source file into a session, reading `status`
  (`uninitialized` / `source-loaded` / `target-selected` / `target-blocked` /
  `ready-for-review` / `ready-for-preview` / `invalid-source`) and the deterministic
  `sourceFingerprint`;
- list selectable teams via `getUteScrapedJsonImportSessionSelectableTargets`, showing
  blocked, empty, and needs-review targets distinctly;
- select a team to surface its canonical mapping and player/coach preview, and clear
  the selection to go back;
- gate "preview" and "import without review" buttons on the summary flags
  `canSelectTarget`, `canProceedToPreview`, and `canProceedWithoutReview`.

That screen remains future work, gated on explicit approval. The session reads source
data only and mutates nothing: it does not persist, store in the browser, upload
files, apply/commit imports, mutate rosters, derive movement, or create coach
analytics, and the loaded payload (if held) is kept by reference only, in memory only.

### Scraped JSON import session review decisions (Phase 5 slice 15)

Slice 15 adds an engine-only **session-level review-decision state** layer
(`src/engine/uteConferenceScrapedJsonImportSessionReviewDecisions.ts`) that is intended
for future UI consumption but **adds no UI itself**. A future review screen could let a
reviewer mark each preview row of the selected target as `confirm-row-identity`,
`mark-row-needs-review`, or `ignore-row-for-review`, then read
`summarizeUteScrapedJsonImportSessionReviewState` to show per-row review status and
counts. The layer is review **metadata only**: decisions never apply, commit, mutate,
suppress, or reorder source data; they are projected onto canonical review-only effects;
and they are auto-isolated to the currently selected target (re-validated on read), so a
screen switching targets cannot show stale decisions. Any commit/apply remains a
separate, later, explicitly approved slice.

### Read-only scraped JSON import UI shell (Phase 5 slice 16)

Slice 16 adds the **first visible import UI**: a read-only scraped JSON import preview
shell (`src/components/ScrapedImportPreview.tsx`), reachable from a top-level
"Import preview (read-only)" view toggle in `App.tsx` alongside the existing roster
view. It is a thin renderer over the existing engine: it builds a slice 14 import
session from a chosen **demo source** (the existing scraped JSON test fixtures, plus
two small inline payloads so the blocked and invalid-source states are visible), lets
the user select one target, and renders the readiness/preview/review state via a pure
view model (`src/app/scrapedImportPreviewViewModel.ts`). It shows the source/readiness
summary, selectable targets, blocked and empty targets (clearly marked not importable),
and — for a selected player target — the canonical context and a read-only player-row
table. All selection lives in component memory; there is no file upload, drag/drop,
persistence, or any apply/commit control. A future slice replaces the demo-source
picker with real source loading.

### Local scraped JSON import preview workflow (Phase 5 slice 17)

Slice 17 turns the shell into a usable **local-first import workbench**. The primary
action is **Choose JSON file**: a real Ute Conference scraped JSON file is read in the
browser with `FileReader` (local only — never uploaded, stored, or persisted), parsed by
a pure helper, and loaded into the existing import session engine. The bundled demo
fixtures remain as a fallback. The workbench shows the source filename/type, readiness
status and summary; groups targets distinctly as ready / needs-review / blocked / empty;
and for a selected target shows canonical context, blocking issues/warnings, the
read-only review state, and preview rows (player rows, or coach rows with raw names and
titles).

It adds a **dry-run projection** panel, clearly labelled "Dry run only · nothing
applied", that shows what an import of a ready player target **would** create (composing
the existing Phase 5 dry-run plan / projection helpers). Blocked, empty, needs-review,
coach, or missing-context targets show a deterministic unavailable state rather than a
forced projection. Primary actions are Choose JSON file, Clear loaded file, Select
target, and Clear selected target; there are deliberately no Save / Apply / Commit /
Import-now controls. Everything stays in component memory — nothing is written,
persisted, or committed, and switching source resets the selected target so no stale
preview/projection leaks.

### Roster-aware identity review (Phase 5 slice 18)

Slice 18 makes the dry run **roster-aware** for player targets. The workbench compares
the selected target's imported rows against the existing local roster for that context
and shows, per row, the identity match status (`likely-new`, `likely-existing`,
`ambiguous`, `needs-review`, `blocked`), the candidate existing name(s), and what the
import **would** do. The reviewer resolves each match-bearing row in memory with explicit
controls — **Confirm match** (only when a single candidate exists), **Create new**,
**Needs review**, and **Clear** — and the dry-run summary updates live (would create /
would link / deferred / unresolved, and whether the dry run is clean). Confirm is never
offered for an ambiguous (duplicate) row, so nothing is auto-linked. Decisions live only
in component memory and are reset when the target or source changes. When no existing
roster matches the context, a clear unavailable message is shown instead of a projection.
All safety wording ("Preview only", "Dry run only · nothing applied") remains, and there
are no Save / Apply / Commit controls — no roster data is written or mutated.

### Staged in-memory roster projection (Phase 5 slice 19)

Slice 19 adds a **Staged projection** section below the dry run. When the dry run is
clean (every imported row resolved), a **Stage preview** action builds an in-memory
projected roster the user can inspect; otherwise the section explains why staging is
unavailable (resolve the remaining rows / missing roster context). The staged view shows
the **actual roster** and the **projected roster** side by side and visually distinct:
the actual roster annotates players that a confirmed import links to, and the projected
roster lists existing players (tagged "existing") plus projected new imported players
(tagged "new"), with counts ("N current + M new = P projected"). Deferred rows are listed
separately as not added. A **Clear staged preview** action removes only the staged view
from memory, and changing the source, target, or any identity decision automatically
invalidates it. It is labelled "Preview only · in memory only · nothing has been
applied"; there are no Save / Apply / Commit / Import-now / Finalize controls, and no
roster data is written, mutated, or persisted.

### In-memory import execution and undo (Phase 5 slice 22)

Slice 22 adds the first controlled WRITE boundary to the workbench — in-memory only. Below
the readiness and transaction-plan panels, an **In-memory import execution** panel offers an
explicit **Execute In-Memory Import** action, available only when the preview is staged, the
transaction plan is `planned`, and no in-memory import is already executed. Executing applies
the plan's additions into the current runtime/session roster view: the **roster tab updates**
to show the added records and displays an "in-memory import active" banner. The execution
panel then shows the executed counts (added / linked no-op / deferred-skipped /
rejected-skipped, before → after roster, net change), explanatory copy ("in-memory only", "no
saved roster data", "this does not persist after reload", "no durable commit occurs"), and an
**Undo In-Memory Import** action that restores the pre-execution roster.

The five workflow layers stay visually distinct: dry-run preview, staged preview,
transaction-plan preview, executed in-memory import, and (still nonexistent) durable
persistence. While an import is executed the workflow is **locked** — the source, target,
review decisions, and staged-preview controls are disabled until the user undoes the import —
so additions cannot be duplicated and no phantom records are orphaned; both app views stay
mounted so the Undo control is never lost by switching tabs. The export artifact records the
`inMemoryExecution` state (`notExecuted` / `executed` / `undone`, always `durable: false` /
`persisted: false`). No durable save / finalize / persist / write-to-roster control exists;
the write is to runtime/session state only and does not survive a reload.

### Portable workspace snapshot toolbar (Phase 5 slice 23)

A persistent **workspace toolbar** in the app shell offers **Export Workspace Snapshot** and
**Import Workspace Snapshot**, labelled "Portable JSON · replaces current in-memory workspace
· no browser storage is used". Export downloads `uc-roster-sniffer-workspace-YYYY-MM-DD.json`
capturing the current in-memory roster (including any executed in-memory import additions)
and does not change app state. Import validates a chosen JSON file: a valid snapshot
**replaces** the workspace (never merges), clears the active in-memory import and the import
workbench's transient state, restores the season/team, and shows a green "Workspace restored"
summary; an invalid file shows a red error notice with the validation reason and leaves the
current workspace unchanged. The toolbar warns that importing replaces the workspace and
clears any active in-memory import (including undo), and that nothing is written to a database
or browser storage. This is explicit file durability only — no auto-save, sync, or
browser/cloud persistence — and is separate from the import preview artifact.

## Team schedule & results (Phase 6 slice 24)

The selected team view shows a read-only **Schedule & Results** section derived from games
between existing teams (opponents resolve through team references — there are no opponent
objects). It displays a record summary (W-L-T, points for, points against, point
differential, upcoming and cancelled counts), the next game, the last result, and a game
list (date/week, home/away, opponent, status, score/result, location). Only `final` games
with scores count toward the record; `scheduled`/`postponed` games are upcoming and
`cancelled` games are shown but excluded from the record. Team with no games shows "No
schedule/results loaded for this team." An unresolved opponent reference is shown inline
("opponent reference could not be resolved") and never crashes the view. Schedules/results
travel with the workspace snapshot.

## Schedule import workbench & in-memory result edits (Phase 6 slice 25)

A dedicated **Schedule import** tab (separate from the read-only roster Import preview) lets
the user load a schedule JSON file (or a bundled demo of the preserved
`schedule-import.sample.json`) and previews it: summary counts (rows / valid / invalid /
additions / updates / skipped / blocking errors) and a row-level table (date/week, home,
away, status, score, outcome add/update/skip/error, and the reason when blocked). **Execute
Schedule Import (In Memory)** is enabled only when the preview is executable; execution is
explicit. After execution the team Schedule & Results view reflects the imported games and an
**Undo Schedule Import** action appears. While executed, the file controls are locked — the
user must undo before loading a different schedule file. Copy states the import is in-memory
only, that workspace snapshot export is the durability path, and that no browser storage or
cloud sync is used.

In the team Schedule & Results section, each game row gains an **Edit Result** control
(shown only when an in-memory update handler is wired): the user edits status, home/away
scores, and notes and clicks **Save Result In Memory**. Final games require both scores;
invalid edits show a readable error and leave state unchanged. The record/summary recalculate
immediately. This is result/status editing only — not full schedule construction. Imported
games and result edits are preserved only through workspace snapshot export/import; importing
a workspace snapshot clears transient schedule-import execution/undo state.

## Game context & standings (Phase 6 slice 26)

The team Schedule & Results section now shows record splits — overall plus **regular
season**, **playoffs** (includes championship games), and **championship** — and each game
row carries context markers (**Playoff**, **Championship**, **Neutral**). Result editing
remains limited to status/scores/notes and preserves the context flags.

A read-only **Standings** tab shows standings for a selected season + age division, derived
from final games only: rank, team, classification (team code), W–L–T, win %, PF, PA, DIFF,
and playoff/championship records, ranked by win percentage then wins, point differential,
points for, and name. Empty states cover no teams and "No final games available for these
standings"; unresolved final references are noted. Schedule imports and result edits flow
into standings immediately and are preserved only through workspace snapshot export/import.

## Import collision UI

During roster import, low-confidence identity matches should be surfaced before final commit.

> Phase positioning: the collision UI below is the **future review screen** for the
> Phase 5 engine pipeline and is **not yet implemented** (see "Import pipeline UI
> (Phase 5 checkpoint)" above). Phase 5 must preserve loaded roster authority and
> must not discard duplicate or ambiguous roster entries.

The collision UI should show:

- raw imported name
- proposed canonical match
- prior known team/district/age division
- confidence level
- reason codes
- available user actions

User actions:

- accept proposed match
- reject proposed match
- manually link
- create new person

## Locked season UI

Locked prior seasons should clearly appear read-only.

The UI should not imply that casual edits are available for historical roster/team composition.
