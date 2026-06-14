# Derived Logic

This document defines initial rules for statuses, rankings, confidence flags, and coaching records.

## Age division order

```text
SC -> GR -> PW -> MM -> GI -> BA
```

Ordinals:

| Division | Ordinal |
| --- | ---: |
| SC | 1 |
| GR | 2 |
| PW | 3 |
| MM | 4 |
| GI | 5 |
| BA | 6 |

## Team classification

Team code is based on draft order and total teams in a district-age-division.

| Total Teams | Draft Order 1 | Draft Order 2 | Draft Order 3 | Draft Order 4 | Draft Order 5+ |
| ---: | --- | --- | --- | --- | --- |
| 1 | A1 | | | | |
| 2 | A2 | D2 | | | |
| 3 | A3 | C1 | C2 | | |
| 4 | A4 | B1 | B2 | B3 | |
| 5+ | A4 | B1 | B2 | B3 | B4, B5, ... |

No `D1` exists.

A-team designation caps at `A4`.

## Competitive hierarchy

Promotion and relegation calculations should use this hierarchy:

```text
A(x) > B1 > C1 = B2 > B3+ = C2 = D2
```

Where:

- `A(x)` means any valid A-code (`A1`, `A2`, `A3`, `A4`) and is the **top**
  competitive tier. All A-codes are hierarchy-equivalent — A-code to A-code
  movement is lateral. (A-team designation caps at `A4`; see `## Team
  classification`.)
- `C1` and `B2` are equivalent competitive tiers.
- `B3+` means B3, B4, B5, and any higher B-numbered team.
- `B3+`, `C2`, and `D2` are equivalent competitive tiers.

A ranking map (higher number is the stronger tier):

```json
{
  "A": 500,
  "B1": 400,
  "C1": 300,
  "B2": 300,
  "B3_PLUS": 100,
  "C2": 100,
  "D2": 100
}
```

A-codes encode division size (`A1`..`A4`) but, for competitive ranking, are
treated as a single equivalent top tier. This resolves the earlier open item
about A-code participation in promotion/relegation: a move up to any A-code is a
promotion, a move down from any A-code is a relegation, and A-code to A-code
movement is lateral.

## Player roster status

Every player assignment in a current season should receive a derived roster status when compared to the prior season.

Supported statuses:

```text
returning
new
transfer
yUp
zDown
promoted
relegated
lateral
lowConfidence
```

The UI may show the most important status as the primary visual badge and additional statuses as secondary details.

### Implementation status (Phase 2 checkpoint)

The Phase 2 deterministic engine implements only the exact-identity subset of the
statuses above:

- Implemented current-player statuses: `returning`, `new`, and `unknown`.
- `not-returning` is also derived, but only in prior-season comparison/summary
  context (a prior-season player absent from the current roster). It is never
  shown as a current player-card status.
- `unknown` is the derived status when identity cannot be safely resolved — for
  example, two same-name (duplicate) current entries.

Confidence is tracked as a separate dimension (`high` / `low`) rather than as a
status value. A low-confidence derivation drives a distinct identity-review
warning on the player card; it does not replace the roster status badge. This
supersedes treating `lowConfidence` as a peer status in the list above.

Not yet implemented (deferred to later phases): `transfer`, `yUp`, `zDown`,
`promoted`, `relegated`, and `lateral`. Matching is exact normalized-name only;
there is no fuzzy matching or import-collision resolution in Phase 2.

### Prior-season roster comparison contract (Phase 3 slice 1)

The first Phase 3 slice establishes a stable result shape for a current-vs-prior
roster comparison, without adding any new movement taxonomy. Built on the
existing exact-identity overlap pipeline, it organizes records into four buckets:

- `returning`: a current player with exactly one prior identity match
  (current/prior pair joined into a single entry).
- `newToRoster`: a current player with no prior identity match.
- `notReturning`: a prior player with no current identity match.
- `unknown`: current and/or prior records whose identity key is ambiguous
  (duplicate name) and cannot be safely resolved. Each ambiguous record stays
  individually present; an ambiguous key never also appears in another bucket.

Each entry carries its `identityKey`, the source player record (by reference,
never mutated), the source `side` (`current` / `prior`) where relevant, and a
derived `status` / `confidence` / `reason` reusing the existing high/low
metadata. This is a comparison contract only — `transfer`, promotion/relegation,
`yUp`/`zDown`, fuzzy matching, and collision resolution remain out of scope.

### Prior-season roster comparison summary (Phase 3 slice 2)

The second Phase 3 slice reduces the comparison result above into display count
totals (`summarizePriorSeasonRosterComparison`). It reads derived metadata only
and never alters source records. Counting is perspective-aware:

- `returning` counts each returning entry once, not once per side, so a returning
  player is never double-counted.
- Current-side counts (`newToRoster`, `unknownCurrent`) answer questions about
  current roster records; prior-side counts (`notReturning`, `unknownPrior`)
  answer questions about prior roster records. `unknownTotal` is their sum.
- Record-accounting totals: `totalCurrent = returning + newToRoster +
  unknownCurrent` and `totalPrior = returning + notReturning + unknownPrior`. A
  returning player is represented on both sides, so it intentionally contributes
  to both totals.
- `highConfidence` / `lowConfidence` are tallied over the deduplicated,
  perspective-aware summary set (each returning entry once, plus every
  `newToRoster` / `notReturning` / `unknown` record) using each entry's own
  derived confidence, so `highConfidence + lowConfidence === returning +
  newToRoster + notReturning + unknownTotal`.

No new movement taxonomy is introduced.

### Exact-identity transfer (team-slot) detection (Phase 3 slice 4)

The fourth Phase 3 slice adds a pure deterministic engine helper
(`detectExactPriorSeasonPlayerMovement`) that detects player movement BETWEEN
team slots from the prior season to the current season. It is engine-only: no UI,
no player-card badges, and no import behavior change.

Matching is exact identity only, reusing the existing `getPlayerIdentityKey`
pipeline. A **team slot** is identified across seasons by
`districtId` + `ageDivisionId` + `teamCode`. `seasonId` is intentionally excluded
from same-slot comparison, because the comparison is cross-season by definition.
This is the same same-slot definition documented in `docs/data-model.md`.

The helper returns one perspective-aware output entry per relevant source record,
organized into six buckets:

- `sameTeamReturning`: an exact prior match on the **same** team slot. The current
  and prior source records each get an entry (distinguished by `side`).
- `transferredIn`: current-side record of an exact prior match on a **different**
  team slot (the player the prior team transferred away).
- `transferredOut`: prior-side record of that same different-slot match.
- `newToConference`: a current record whose identity appears nowhere in the prior
  comparison set.
- `notReturning`: a prior record whose identity appears nowhere in the current
  comparison set.
- `unknown`: every record whose identity key is ambiguous (a duplicate on either
  side). Ambiguous keys are classified **only** as `unknown` / low-confidence and
  never as a transfer, same-team, new, or not-returning. Each ambiguous record
  stays individually present.

Relationship to the richer taxonomy below: this slice defines "transfer" purely
as an exact identity on a different team slot. It is a deterministic foundation
and does **not** replace or implement the district-change `Transfer` rule,
`promoted` / `relegated` / `lateral` competitive-tier movement, or `yUp` / `zDown`
cohort reclassification. Those remain future work and are layered on top of this
exact-identity foundation, not in place of it. Source roster records are
preserved by reference and never mutated; ambiguity affects derived metadata only.

### District-aware movement classification (Phase 3 slice 6)

The sixth Phase 3 slice adds a pure deterministic engine helper
(`classifyDistrictAwarePlayerMovement`) that interprets the exact team-slot
movement **signal** from slice 4 into product-level movement statuses. It is
engine-only: no UI, no player-card badges, and no import behavior change.

This is a **classification layer over exact team-slot movement**, not a
replacement for it. The helper calls `detectExactPriorSeasonPlayerMovement`
read-only and never mutates it; each underlying movement entry yields exactly one
classification entry (so the entry count equals the source record count). Source
`player` and `team` references are preserved; classification is fresh derived
metadata only.

Classification rules:

- Same team slot -> `same-team-returning`.
- Different team slot, **same district, same age division** -> compare the
  competitive hierarchy (`A(x) > B1 > C1 = B2 > B3+ = C2 = D2`, where `A(x)` is any
  valid A-code treated as the top tier): current tier higher than prior ->
  `promoted`; lower -> `relegated`; equivalent -> `lateral`.
- Different team slot, **different district** -> `transfer`. Promotion / relegation
  / lateral are intentionally **not** also claimed for a district change, and a
  district change stays `transfer` regardless of age division.
- Different team slot, **same district, different age division** -> the neutral
  `age-division-change`. This is intentionally conservative: y-up / z-down cohort
  reclassification is **not** implemented in this slice and is deferred to Phase 4.
- Current-only exact identity -> `new-to-conference`.
- Prior-only exact identity -> `not-returning`.
- Ambiguous (duplicate-name) identity -> `unknown` only. An ambiguous key is never
  classified as `transfer`, `promoted`, `relegated`, or `lateral`.

Each classification entry carries `identityKey`, `side`, the source `player` and
`record` (by reference), the resolved `currentTeam` / `priorTeam` slot context
where applicable, and a `status` / `confidence` / `reason` verdict. Reasons map
1:1 to the cases above (for example `same-team-slot`, `same-district-higher-team`,
`different-district`, `same-district-different-age-division`, `new-current-identity`,
`missing-current-identity`, `ambiguous-identity`).

**Conservative tier fallback.** Promotion/relegation/lateral ranking uses the
existing `compareTeamClassifications` helper, which ranks valid A-codes
(`A1`..`A4`) as the top tier plus `B1`, `C1`, `B2`, `B3+`, `C2`, and `D2`. Valid
A-codes are rankable and never hit this fallback. When a same-district, same-age
move involves a team code that is genuinely unsupported/invalid and cannot be
parsed (e.g. a malformed code, or an out-of-range code like `C3`), the helper does
**not** throw and does **not** claim a direction: it reports a low-confidence
`lateral` with reason `same-district-unrankable-team` for review.

Y-up / z-down are **not** implemented in this slice. They are cohort
reclassification events (see `## Y-Up / Z-Down`) layered later in Phase 4 on top
of this classification foundation, not folded into it.

### Cohort reclassification signal detection (Phase 4 slice 1)

The first Phase 4 slice adds a pure deterministic engine helper
(`detectCohortReclassificationSignals`) that flags possible y-up / z-down cohort
reclassification **candidates** by comparing an exact-identity player's
prior-season and current-season age divisions. It is engine-only: no UI, no
player-card badges, and no import behavior change.

This is a **signal layer only**. It detects candidates; it does **not** persist a
cohort offset, carry reclassification forward across future seasons, or reset a
preserved path. That preservation work (cohort offset fields, carry-forward, and
review/reset conditions described under `## Y-Up / Z-Down`) is the rest of Phase 4
and is layered on top of this signal, not folded into it.

Matching is exact identity only, reusing `getPlayerIdentityKey` (no fuzzy
matching, no initial inference). Classification uses age-division **ordinal**
movement only (`SC < GR < PW < MM < GI < BA`); it deliberately does **not**
consult grade, birthdate, player age, or roster notes.

The helper returns one perspective-aware entry per relevant source record (entry
count equals `currentRecords.length + priorRecords.length`). Classification per
identity key:

- Exact match, current ordinal exactly one above prior ->
  `expected-age-progression` / high / `normal-one-division-progression`
  (e.g. GR -> PW).
- Exact match, unchanged division -> `same-age-division` / high /
  `unchanged-age-division` (e.g. PW -> PW).
- Exact match, current ordinal more than one above prior -> `y-up-candidate` /
  high / `skipped-age-division` (e.g. GR -> MM).
- Exact match, current ordinal one or more below prior -> `z-down-candidate` /
  high / `moved-down-age-division` (e.g. MM -> PW).
- Exact match where either side's age division is missing/unsupported ->
  `unknown` / low / `invalid-age-division`. The raw division value is still
  reported, not suppressed.
- Current-only exact identity -> `unknown` / low / `missing-prior-record`.
- Prior-only exact identity -> `unknown` / low / `missing-current-record`.
- Ambiguous (duplicate-name) identity on either side -> `unknown` / low /
  `ambiguous-identity` only. An ambiguous key is never given a candidate verdict.

Each entry carries `identityKey`, `side`, the source `player` and `record` (by
reference), the resolved `currentTeam` / `priorTeam` slot context and
`currentAgeDivisionId` / `priorAgeDivisionId` where applicable (`null`
otherwise), and a `signal` (`status` / `confidence` / `reason`) verdict.

Y-up / z-down here are **candidate signals only**, not a persisted cohort status,
and no UI badge is implied. Loaded roster records remain authoritative and are
preserved by reference and never mutated; ambiguity affects derived metadata only.

### First-year cohort reclassification record (Phase 4 slice 2)

The second Phase 4 slice adds a pure deterministic engine helper
(`deriveFirstYearCohortReclassificationRecords`) that consumes the slice 1 signal
output and records the **first-year cohort reclassification event** for the
high-confidence y-up / z-down candidates only. It is engine-only: no UI, no
player-card badges, and no import behavior change.

Slice 1 **detects** y-up / z-down candidates; this slice **records** the
first-year event derived from those candidates. It adds no detection of its own:
there is no fuzzy matching, no initial inference, and no consult of grade,
birthdate, player age, roster notes, or manual review decisions. The records are
still derived metadata.

A record is created only for a slice 1 entry whose `signal.status` is
`y-up-candidate` or `z-down-candidate` **and** whose `signal.confidence` is
`high`, with usable current/prior team context, usable `seasonId`s on both sides,
and valid age divisions on both sides. Each record carries:

- `reclassificationType` (`y-up` / `z-down`) and `sourceStatus`
  (`y-up-candidate` / `z-down-candidate`).
- `firstDetectedSeasonId` (current team `seasonId`) and `priorSeasonId` (prior
  team `seasonId`).
- `priorAgeDivisionId` / `currentAgeDivisionId` (the raw source division ids).
- `ageDivisionDelta`: age-division ordinal movement (current minus prior),
  **positive** for `y-up`, **negative** for `z-down`.
- `identityKey`, the source `player`, `currentTeam`, and `priorTeam` references.
- `confidence` (`high`) and `reason` (`first-year-y-up-detected` /
  `first-year-z-down-detected`).

No record is created for `expected-age-progression`, `same-age-division`,
`unknown`, any low-confidence entry, an ambiguous identity (never a candidate in
slice 1), or an entry missing current/prior team context, a usable season id, or
a valid age division. Skipped entries are returned alongside the records with a
skip reason.

Slice 1 emits one entry per source record, so an exact-identity event has both a
current-side and a prior-side entry. This slice produces **one record per
identity event**, preferring the current-side entry as the canonical source; the
redundant prior-side perspective is skipped as `duplicate-perspective`.

This is **first-year recording only**. It does **not** carry the cohort status
forward into future seasons, persist a cohort offset to storage, reset a
preserved path, or alter roster records. Loaded roster records remain
authoritative and are preserved by reference and never mutated. A later Phase 4
slice may preserve / carry the cohort reclassification across later seasons when
the player travels with the reclassified cohort (see `## Y-Up / Z-Down`).

### Cohort reclassification carry-forward (Phase 4 slice 3)

The third Phase 4 slice adds a pure deterministic engine helper
(`carryForwardCohortReclassificationStatus`) that preserves a recorded y-up /
z-down status while the player keeps traveling along the reclassified cohort path
in a **later** season, and flags the path as broken when the player leaves it. It
is engine-only: no UI, no player-card badges, no import behavior, and no
persistence.

To recap the slice sequence: slice 1 **detects** y-up / z-down candidate signals,
slice 2 **records** the first-year cohort reclassification event, and this slice
**carries** that recorded status forward across later seasons. Carry-forward is
still **derived metadata** — it never mutates, removes, suppresses, or reorders a
roster record. A broken path is a **review signal, not data deletion**.

#### Inputs

The helper accepts a narrow input model:

- `firstYearRecords`: the slice 2 `CohortReclassificationRecord[]`.
- `currentRecords`: later-season `RosterMovementRecord[]` (player + team slot
  context), the roster being evaluated against the recorded events.
- `seasonOrder`: season ids ordered **oldest to newest**, used to count how many
  seasons elapsed between first detection and the evaluated season.

#### Cohort offset and the reclassified path

A first-year record establishes a cohort **offset** relative to normal age
progression. Normal progression is **+1 age division per season**
(`SC < GR < PW < MM < GI < BA`). The offset is computed relative to the normal
expected division, **not** from the raw year-over-year delta:

```text
expectedCurrentRank = priorRank + 1
cohortOffset        = firstDetectedRank - expectedCurrentRank
```

- `GR -> PW`: raw delta +1, cohortOffset 0 — no reclassification (never recorded).
- `GR -> MM`: raw delta +2, cohortOffset +1 — y-up.
- `MM -> PW`: raw delta -1, normal would be GI, cohortOffset -2 — z-down.

`cohortOffset` is **positive for y-up** and **negative for z-down**, and is never
zero for an actual recorded candidate. Because the offset is constant and the
normal path advances +1 per season, the reclassified path also advances +1 per
season from the first detected division:

```text
expectedAgeDivisionRank(evaluatedSeason) = firstDetectedRank + seasonSteps
```

clamped to the `SC..BA` bounds, where `seasonSteps` is the number of seasons the
evaluated season is after the first detected season per `seasonOrder`.

#### Classification

Per first-year record (exactly one entry per record, in input order):

- **Same season as first detection** (`seasonSteps == 0`) -> `first-year` /
  `first-year-record`.
- **On the reclassified offset path** (`actualRank == expectedRank`) ->
  `carried-forward` / `expected-offset-path`. If the offset path would advance
  past BA and the player remains BA, the reason is `capped-at-top-division`
  (symmetric `capped-at-bottom-division` below SC); the status stays
  `carried-forward`. The engine never invents divisions beyond `SC..BA`.
- **Returned to the normal age path** (`actualRank == priorRank + 1 +
  seasonSteps`) -> `path-broken` / `returned-to-normal-path`.
- **Any other division** -> `path-broken` / `unexpected-age-division`.

Conservative (non-carrying) outcomes:

- **No single matching later-season record** -> `insufficient-history` /
  `missing-current-record`.
- **Duplicate / ambiguous later-season identity** -> `unknown` /
  `ambiguous-identity` (never carried forward).
- **Invalid age division** on either side -> `unknown` / `invalid-age-division`
  (the raw division value is still surfaced).
- **Unusable season ordering** -> `insufficient-history` with a reason that names
  the ordering problem: `missing-season-order`, `first-season-not-in-order`,
  `evaluated-season-not-in-order`, or `evaluated-season-before-first-detection`.

`confidence` is `high` for the definitive verdicts (`first-year`,
`carried-forward`, `path-broken`) and `low` for the conservative
`insufficient-history` / `unknown` outcomes.

Each entry carries `identityKey`, `reclassificationType`, the source `player`,
`firstYearRecord`, and matched `currentRecord` references,
`firstDetectedSeasonId` / `evaluatedSeasonId`, `priorAgeDivisionId` /
`firstDetectedAgeDivisionId` / `expectedAgeDivisionId` / `actualAgeDivisionId`,
the `cohortOffset`, and the `status` / `confidence` / `reason` verdict. A summary
helper (`summarizeCohortReclassificationCarryForward`) counts entries by status,
reclassification type, and confidence.

This slice does **not** persist a cohort offset to storage, add UI badges, change
import behavior, use fuzzy matching, or consult birthdate, grade, notes, or manual
review decisions. Loaded roster records, players, teams, and first-year records
remain authoritative and are preserved by reference and never mutated.

### Cohort reclassification review classification (Phase 4 slice 4)

The fourth Phase 4 slice adds a pure deterministic engine helper
(`classifyCohortReclassificationReview`) that sits **on top of** the slice 3
carry-forward result and classifies each carry-forward verdict into a simple
**review outcome** a human can act on. It accepts either the slice 3 result object
(`{ entries, summary }`) or a bare entry array.

This slice **classifies** carry-forward results into review outcomes. It does
**not** persist a review decision, reset cohort status automatically, add UI
badges, or alter roster records. A broken path is a **review signal**, and reset is
only **recommended, never performed**. Future slices may add persistence and a
manual review / reset workflow.

#### Review statuses

- `clean` — the carry-forward verdict is trustworthy as-is.
- `needs-review` — a human should look before trusting the verdict.
- `reset-recommended` — the player has rejoined the normal age path, so a reviewer
  may wish to reset the preserved cohort status. The reset is **not** performed.
- `insufficient-data` — there is not enough information (no current record, or an
  unusable season ordering) to judge the carried-forward status.

#### Mapping

Per carry-forward entry (exactly one review entry per carry-forward entry, in input
order):

| Carry-forward status | Carry-forward reason | reviewStatus | confidence | review reason |
| --- | --- | --- | --- | --- |
| `first-year` | (any) | `clean` | high | `valid-first-year-record` |
| `carried-forward` | (any) | `clean` | high | `valid-carry-forward` |
| `path-broken` | `returned-to-normal-path` | `reset-recommended` | high | `path-broken-returned-to-normal` |
| `path-broken` | `unexpected-age-division` | `needs-review` | low | `path-broken-unexpected-age-division` |
| `insufficient-history` | `missing-current-record` | `insufficient-data` | low | `missing-current-record` |
| `insufficient-history` | `missing-season-order` / `first-season-not-in-order` / `evaluated-season-not-in-order` / `evaluated-season-before-first-detection` | `insufficient-data` | low | `unusable-season-order` |
| `unknown` | `invalid-age-division` | `needs-review` | low | `invalid-age-division` |
| `unknown` | `ambiguous-identity` | `needs-review` | low | `ambiguous-identity` |

An otherwise-clean entry (`first-year` / `carried-forward`) that carried forward
with **low** confidence is demoted to `needs-review` / `low-confidence-carry-forward`
so it is confirmed before being trusted. Any carry-forward verdict whose reason is
not covered above falls back to `unknown-carry-forward-result` (review status
`needs-review` for `unknown`, `insufficient-data` for `insufficient-history`, and
`needs-review` for an unmapped `path-broken` reason). `confidence` is `high` only
for the `clean` outcomes and `reset-recommended`; everything else is `low`.

Each review entry preserves the source `carryForwardEntry`, `player`,
`firstYearRecord`, and `currentRecord` references (by reference, never copied),
mirrors `identityKey`, `reclassificationType`, and `evaluatedSeasonId`, and records
the `carryForwardStatus` / `carryForwardReason` it classified alongside the derived
`reviewStatus` / `confidence` / `reason`. A summary helper
(`summarizeCohortReclassificationReview`) counts entries by review status,
reclassification type, and confidence.

This slice does **not** persist review decisions, reset cohort status, add UI
badges, change import behavior, use fuzzy matching, or consult birthdate, grade,
notes, or manual review/override. Loaded roster records, players, teams, first-year
records, and carry-forward entries remain authoritative and are preserved by
reference and never mutated.

### Cohort reclassification derived assignment (Phase 4 slice 5)

The fifth Phase 4 slice adds a pure deterministic engine helper
(`deriveCohortReclassificationAssignments`) that folds the slice 4 review result
(which already carries its slice 3 carry-forward entry) into a single, flat
per-player-season **cohort assignment** a caller can read directly. It accepts
either the slice 4 result object (`{ entries, summary }`) or a bare review entry
array.

This is an **in-memory derived assignment model** that **combines** the
carry-forward and review results. It does **not** persist to storage, mutate roster
records, add UI badges, or perform a reset. `resetRecommended` is **advisory only**.
Future slices may wire these assignments into persistence, manual review, or UI.

#### Active statuses

- `active` — a carried-forward y-up / z-down is currently in effect.
- `first-year` — the reclassification is in its first detected season.
- `inactive` — the player has returned to the normal age path; the preserved status
  is no longer in effect and a reset is recommended (but not performed).
- `review` — a human should look before trusting the status.
- `insufficient-data` — not enough information to judge (no current record, or an
  unusable season ordering).
- `unknown` — an unmapped review / carry-forward combination.

#### Mapping

Per review entry (exactly one assignment per review entry, in input order):

| reviewStatus | carryForwardStatus | activeStatus | resetRecommended | confidence | assignment reason |
| --- | --- | --- | --- | --- | --- |
| `clean` | `first-year` | `first-year` | false | high | `first-year-active` |
| `clean` | `carried-forward` | `active` | false | high | `carried-forward-active` |
| `reset-recommended` | (any) | `inactive` | true | high | `reset-recommended` |
| `needs-review` | (any) | `review` | false | low | `review-required` |
| `insufficient-data` | (any) | `insufficient-data` | false | low | `insufficient-data` |
| (any other combination) | (any) | `unknown` | false | low | `unknown-status` |

A `clean` review status is only emitted by slice 4 for a `first-year` or
`carried-forward` carry-forward status, so a `clean` review paired with any other
carry-forward status falls through to `unknown` / `unknown-status`. `confidence` is
`high` only for the active / first-year / inactive (reset-recommended) outcomes;
`review`, `insufficient-data`, and `unknown` are `low`.

Each assignment preserves the source `reviewEntry`, `carryForwardEntry`, `player`,
`firstYearRecord`, and `currentRecord` references (by reference, never copied),
mirrors the carry-forward entry's derived facts (`identityKey`,
`reclassificationType`, `firstDetectedSeasonId`, `evaluatedSeasonId`,
`priorAgeDivisionId`, `firstDetectedAgeDivisionId`, `expectedAgeDivisionId`,
`actualAgeDivisionId`, `cohortOffset`), and records the upstream
`carryForwardStatus` / `carryForwardReason` / `reviewStatus` / `reviewReason`
alongside the derived `activeStatus` / `resetRecommended` / `confidence` / `reason`.
A summary helper (`summarizeCohortReclassificationAssignments`) counts assignments
by active status, reset recommendation, reclassification type, and confidence.

This slice does **not** persist assignments, reset cohort status, add UI badges,
change import behavior, use fuzzy matching, or consult birthdate, grade, notes, or
manual review/override. Loaded roster records, players, teams, first-year records,
carry-forward entries, and review entries remain authoritative and are preserved by
reference and never mutated.

### Cohort assignment review action model (Phase 4 slice 6)

The sixth Phase 4 slice adds a pure deterministic engine helper
(`applyCohortReclassificationReviewAction`) that defines what a **future** manual
review workflow MAY do with a slice 5 assignment. It takes one assignment plus a
requested action and returns an explicit, validated **review-action result**.

This is an **engine-only action result model**. It validates possible future review
actions; it does **not** persist any review decision, reset anything automatically
(an accepted `reset` only records that the recommendation was accepted — no cohort
status is changed), mutate roster records, or add UI. Future slices may persist
accepted actions or wire a manual review screen.

#### Actions

- `confirm` — accept the assignment's status.
- `reset` — accept a reset recommendation on a broken (inactive) assignment.
- `defer` — postpone a decision on a questionable (review) assignment.
- `mark-insufficient-data` — record that an insufficient-data assignment cannot be
  judged yet.

The action input also accepts optional `reviewerNote`, `reviewedAt`, and
`reviewerId`; `reviewerId` is not required by this slice. Provided values are echoed
back on the result (non-empty strings only); absent values stay absent.

#### Resulting review states

`confirmed`, `reset`, `deferred`, `insufficient-data`, or `rejected`.

#### Mapping

| requestedAction | assignment activeStatus | accepted | resultingReviewState | resultingActiveStatus | reason |
| --- | --- | --- | --- | --- | --- |
| `confirm` | `active` / `first-year` | true | `confirmed` | unchanged | `clean-assignment-confirmed` |
| `confirm` | `review` | true | `confirmed` | `active` | `review-assignment-confirmed` |
| `reset` | `inactive` (resetRecommended true) | true | `reset` | `inactive` (resetRecommended cleared) | `reset-recommendation-accepted` |
| `reset` | `active` / `first-year` | false | `rejected` | unchanged | `reset-not-allowed-for-clean-assignment` |
| `defer` | `review` | true | `deferred` | `review` | `review-deferred` |
| `mark-insufficient-data` | `insufficient-data` | true | `insufficient-data` | `insufficient-data` | `insufficient-data-marked` |
| `mark-insufficient-data` | (any other) | false | `rejected` | unchanged | `insufficient-data-action-not-needed` |
| (any) | `unknown` | false | `rejected` | unchanged | `unknown-assignment-state` |
| (any other invalid pairing) | — | false | `rejected` | unchanged | `invalid-action-for-assignment` |
| (any) | no assignment supplied | false | `rejected` | `unknown` | `missing-assignment` |

An `unknown` assignment state rejects every action before the action type is even
considered. A rejected result leaves `resultingActiveStatus` / `resetRecommended`
unchanged — nothing is committed in any case. `confidence` is `high` for the
definite accepted outcomes (`confirmed`, `reset`) and `low` for `deferred`,
`insufficient-data`, and every rejection.

Each result preserves the source `assignment` reference (and through it every
upstream object), mirrors `identityKey` / `reclassificationType` /
`evaluatedSeasonId`, and records the `requestedAction`, `accepted`,
`resultingReviewState`, `resultingActiveStatus`, `resetRecommended`, `confidence`,
and `reason`. A summary helper
(`summarizeCohortReclassificationReviewActions`) counts results by acceptance,
resulting review state, and requested action type.

This slice does **not** persist actions, reset cohort status, mutate roster records,
add UI, change import behavior, use fuzzy matching, or consult birthdate, grade,
notes, or manual review storage. The source assignment and every upstream object
remain authoritative and are preserved by reference and never mutated.

### Cohort review decision persistence contract (Phase 4 slice 7)

The seventh Phase 4 slice defines the **persistence contract** for an accepted
cohort review decision and adds small pure helpers to build, validate, and
summarize those decisions (`createCohortReviewDecision`,
`validateCohortReviewDecision`, `summarizeCohortReviewDecisions`). The persistable
shape is documented in `docs/data-model.md` ("Cohort Review Decision").

This slice defines the **contract only**. It does **not** write to storage (no
localStorage / IndexedDB / file), add UI, mutate roster records, unlock prior
seasons, or perform any reset side effect. A persisted decision is a SEPARATE,
append-only record from any roster row.

#### Contract rules

1. Only an **accepted** slice 6 action result may become a decision; a rejected
   result is skipped with `action-not-accepted`.
2. Decisions are **append-only**: a later decision may reference an earlier one via
   `audit.supersedesDecisionId`, but the helper never mutates an earlier decision or
   any source object.
3. Decisions never mutate roster records and never unlock or edit prior seasons.
4. A `reset` decision ends the active cohort status from the evaluated-season
   perspective (`resultingActiveStatus` is not active) but does **not** delete the
   first-year reclassification event record.
5. `confirm` decisions preserve active cohort status; `defer` and
   `insufficient-data` decisions preserve the review state without forcing an
   active/inactive status.
6. Each decision carries a `source` block (assignment / review / carry-forward
   status + reason and a `logicVersion`) so the decision can be re-audited.

#### Build (`createCohortReviewDecision(actionResult, options)`)

Pure and deterministic: ids and timestamps are **caller-provided** (the helper
never calls `Date.now()` or generates ids), and it returns a result object instead
of throwing on normal validation failures. It refuses to build a decision (returns
`created: false` with an explaining `reason`) when:

- the action result is not accepted -> `action-not-accepted`;
- there is no source assignment -> `missing-assignment`;
- the identity key is empty -> `missing-identity-key`;
- the evaluated season is missing -> `missing-evaluated-season` (e.g. an
  insufficient-data assignment from a missing current record has no evaluated
  season, so it cannot become a decision);
- the caller omits `decisionId` -> `missing-decision-id`;
- the caller omits `createdAt` -> `missing-created-at`.

Optional `reviewerNote` / `reviewedAt` / `reviewerId` (from the action result) and
`createdBy` / `supersedesDecisionId` (from options) are attached only when supplied
as non-empty strings; `lockedSourceSeasonIds` is stored as a fresh copy of the
caller's array.

#### Validate (`validateCohortReviewDecision(decision)`)

Returns `{ valid, errors }`. It checks the required identity / season / id /
timestamp fields, valid `decisionType` and `reviewActionState`, their coherence, and
the two contract guards — a `reset` decision must not claim an `active` /
`first-year` status (`reset-decision-claims-active-status`) and a `confirm` decision
must not claim a `reset` state (`confirm-decision-claims-reset-state`).

#### Summarize (`summarizeCohortReviewDecisions(decisions)`)

Counts decisions by type (`confirm` / `reset` / `defer` / `markInsufficientData`),
reclassification type (`yUp` / `zDown`), reviewer-note presence, supersession, and
validity (`invalid`). Pure; validity is computed via
`validateCohortReviewDecision` and nothing is mutated.

Future slices may add local storage integration and a manual review screen on top of
this contract. Source roster records, players, teams, first-year records, and every
upstream derived object remain authoritative and are never mutated.

### Cohort review decision application (Phase 4 slice 8)

The eighth Phase 4 slice adds a pure deterministic engine helper
(`applyCohortReviewDecisionsToAssignments`) that resolves derived cohort
assignments (slice 5 — what the engine thinks) against append-only cohort review
decisions (slice 7 — what a reviewer decided), computing the **effective** state
per assignment **in memory**.

This is **not storage**. It does not write to localStorage / IndexedDB / files /
sample data / app state — it only reads the provided decision records. It never
mutates assignments, decisions, first-year records, players, teams, or roster
records. A `reset` decision changes only the EFFECTIVE derived state; it never
deletes the first-year reclassification event record.

#### Matching

A decision matches an assignment on `identityKey` + `evaluatedSeasonId` +
`reclassificationType`. A decision missing a usable key (empty `identityKey` or
`evaluatedSeasonId`) is ignored; a decision whose `reclassificationType` differs
(or is null) simply does not match any assignment.

#### Per-assignment resolution

One entry per assignment, in input order:

| Situation | decisionApplied | effectiveActiveStatus | effectiveReviewState | reason |
| --- | --- | --- | --- | --- |
| No matching decision | false | engine value | `engine-derived` | `no-decision-engine-derived` |
| `confirm` | true | decision `resultingActiveStatus` | `confirmed` | `confirmed-decision-applied` |
| `reset` | true | `inactive` | `reset` | `reset-decision-applied` |
| `defer` | true | `review` | `deferred` | `deferred-decision-applied` |
| `mark-insufficient-data` | true | `insufficient-data` | `insufficient-data` | `insufficient-data-decision-applied` |
| Multiple current matches | false | engine value | `unresolved-review` | `multiple-current-decisions` |

`confidence` is `high` for applied `confirm` / `reset`, `low` for applied `defer` /
`mark-insufficient-data` and for a conflict, and mirrors the assignment's own
confidence for the engine-derived (no-decision) case.

#### Ignored decisions

Decisions that are not applied are reported separately (in input order) with a
reason: `missing-decision-key`, `invalid-decision-ignored` (per
`validateCohortReviewDecision`), `superseded-decision-ignored`,
`no-matching-assignment`, or `multiple-current-decisions`.

- **Supersession is by reference.** Any decision whose `decisionId` appears as
  another decision's `audit.supersedesDecisionId` is ignored; the latest
  non-superseded matching decision applies.
- **Conflicts are not guessed.** If two or more valid, non-superseded decisions
  match the same assignment and none supersedes the others, none is applied and the
  effective active status stays engine-derived. Array order is never used to pick a
  winner.

A summary helper (`summarizeAppliedCohortReviewDecisions`) counts entries by
effective state, decision application, and confidence, and ignored decisions by
reason.

Future slices may add actual local storage and a manual review UI on top of this
resolution. Source roster records and every upstream object remain authoritative
and are never mutated.

### Cohort review decision repository (Phase 4 slice 9)

The ninth Phase 4 slice adds the narrow **repository / storage-boundary** layer for
cohort review decisions: how decisions are appended, loaded, validated, and
exported / imported at the local data boundary
(`src/engine/cohortReviewDecisionRepository.ts`). The repository state shape is
`{ version, decisions }` and the persisted/export payload is documented in
`docs/data-model.md` ("Cohort Review Decision Repository").

The app has no browser-storage persistence layer yet (only static JSON sample
loading). So this is an **in-memory repository adapter** plus a documented,
JSON-compatible export/import contract — **not** a real storage implementation. It
does **not** write to localStorage / IndexedDB / files / sample data / app state,
add UI, or mutate roster records.

#### Behavior

- **Append-only.** `appendCohortReviewDecision` / `appendCohortReviewDecisions`
  validate each decision via `validateCohortReviewDecision`, accept valid ones, and
  reject invalid (`invalid-decision`) and duplicate-`decisionId`
  (`duplicate-decision-id`) decisions. Duplicates are detected against both existing
  state and earlier decisions in the same batch, and an existing decision is never
  overwritten. Every operation returns a NEW state; the prior state and the decision
  objects are never mutated. Append results are
  `{ ok, state, accepted, rejected, messages }`, where `ok` is true only when
  nothing was rejected.
- **Load.** `getCohortReviewDecisions` returns all decisions in append order (as a
  fresh array). `getActiveCohortReviewDecisions` returns only the decisions not
  superseded by another decision's `audit.supersedesDecisionId`; superseded
  decisions remain in history and are excluded from the active view only.
- **Export / import.** `exportCohortReviewDecisionRepository` returns a plain
  JSON-compatible `{ version, decisions }` payload (no functions).
  `importCohortReviewDecisionRepository` validates the envelope
  (`invalid-repository-payload`, `unsupported-repository-version`,
  `missing-decision-list`) and then validates each decision, performing a **partial
  import** that clearly reports accepted and rejected decisions and returns a new
  state.

Decision objects are stored and returned by reference (not cloned); the repository
never mutates them, so this is safe by convention and callers must treat returned
decisions as read-only. Future slices may wire this repository to actual local
storage and a manual review UI. Roster records, assignments, first-year records,
players, and teams are never mutated.

### Phase 4 checkpoint: cohort reclassification preservation pipeline (Phase 4 slice 10)

Phase 4 is **checkpointed / complete**. Slices 1–9 build one engine-only,
pure-and-deterministic pipeline that detects a y-up / z-down cohort
reclassification, preserves it while the player travels with the reclassified
cohort, classifies it for review, models a manual review action, captures an
accepted decision as an append-only record, applies decisions to derived
assignments in memory, and models a local storage-boundary repository for those
decisions. This slice adds no product logic; it confirms the contracts before
Phase 5 (import preview and identity collision handling).

#### End-to-end pipeline

The data flows in one direction, each stage layered on top of the previous one
(never folded into it). Every stage lives in `src/engine/` and is covered by a
matching `src/test/` suite.

1. **Signal detection** — `detectCohortReclassificationSignals`
   (`cohortReclassificationSignal.ts`). Classifies exact-identity year-over-year
   age-division movement into `expected-age-progression`, `same-age-division`,
   `y-up-candidate`, `z-down-candidate`, or `unknown`, using age-division ordinal
   movement only. Candidate signal only — no persisted cohort status.
2. **First-year record derivation** — `deriveFirstYearCohortReclassificationRecords`
   (`cohortReclassificationRecord.ts`). Consumes the signal output and records the
   **first-year** y-up / z-down event for high-confidence candidates only, one
   record per identity event, with `ageDivisionDelta` positive for y-up and
   negative for z-down.
3. **Carry-forward and path-break detection** —
   `carryForwardCohortReclassificationStatus`
   (`cohortReclassificationCarryForward.ts`). Takes first-year records plus a
   later-season roster and `seasonOrder` (oldest to newest) and decides whether the
   player is still on the reclassified offset path. Computes `cohortOffset`
   (`firstDetectedRank - (priorRank + 1)`) and the expected division on the offset
   path (`firstDetectedRank + seasonSteps`, capped at SC..BA). Verdicts:
   `first-year`, `carried-forward`, `path-broken`, and the conservative
   `insufficient-history` / `unknown`. A broken path is a review signal, not data
   deletion.
4. **Review classification** — `classifyCohortReclassificationReview`
   (`cohortReclassificationReview.ts`). Maps each carry-forward verdict into a
   review outcome: `clean`, `reset-recommended`, `needs-review`, or
   `insufficient-data`. Reset is recommended, never performed.
5. **Derived assignment model** — `deriveCohortReclassificationAssignments`
   (`cohortReclassificationAssignment.ts`). Folds the review result into one flat
   per-player-season cohort assignment with an `activeStatus` (`first-year`,
   `active`, `inactive` + `resetRecommended`, `review`, `insufficient-data`,
   `unknown`), surfacing the applied `cohortOffset` and upstream statuses/reasons.
   This is in-memory derived state, **not** a roster mutation.
6. **Manual review action validation** — `applyCohortReclassificationReviewAction`
   (`cohortReclassificationReviewAction.ts`). Takes one assignment plus a requested
   action (`confirm`, `reset`, `defer`, `mark-insufficient-data`) and returns a
   validated accepted/rejected result with a `resultingReviewState`. An accepted
   `reset` only records that the recommendation was accepted; nothing is committed.
7. **Persisted-style review decision creation** — `createCohortReviewDecision`
   (`cohortReviewDecision.ts`). Builds the separate, append-only
   `Cohort Review Decision` record (see `docs/data-model.md`) from an **accepted**
   action result only. Ids and timestamps are caller-provided (no `Date.now()`);
   `validateCohortReviewDecision` and `summarizeCohortReviewDecisions` round out the
   contract.
8. **Decision application to assignments** —
   `applyCohortReviewDecisionsToAssignments` (`cohortReviewDecisionApplication.ts`).
   Resolves assignments against decisions in memory, computing an effective state
   per assignment (engine-derived / confirmed / reset / deferred /
   insufficient-data / unresolved-review). Conflicting current decisions are never
   resolved by array order; a reset changes effective state only.
9. **Local repository / storage-boundary contract** —
   `cohortReviewDecisionRepository.ts`. Models the local data boundary
   (`{ version, decisions }`) with pure append / load / active-view / export /
   import helpers. An in-memory adapter plus a JSON-compatible export/import
   contract — not a real storage implementation.

#### Phase 4 is pure and deterministic

Every Phase 4 stage is a pure function (or a pure module returning new state) with
no side effects. Across the whole pipeline there is:

- no browser persistence;
- no `localStorage`;
- no `IndexedDB`;
- no file writes;
- no React state wiring;
- no UI (no player-card badges, no review screen);
- no sample-data mutation;
- no roster mutation;
- no reset side effect (`resetRecommended` and an accepted `reset` are advisory /
  recorded only).

Ids and timestamps are always caller-provided, so output is fully reproducible.

#### Append-only decision history

- Decisions may affect derived **assignment state in memory** (via slice 8
  application), but they never rewrite source data.
- Decisions do **not** delete or rewrite roster records.
- Decisions do **not** delete first-year cohort reclassification event records — a
  `reset` ends the active status from the evaluated-season perspective only.
- Superseded decisions remain in repository history (referenced by
  `audit.supersedesDecisionId`) and are excluded from the active view only; they
  are never overwritten or removed.

#### Roster authority rule (carried forward, unchanged)

- Loaded roster records remain authoritative (see `## Roster authority`).
- Duplicates, ambiguity, and low confidence may affect derived metadata / review
  state only.
- Rostered names must never be altered, removed, suppressed, merged, nullified,
  reordered, or ignored. Source objects are preserved by reference throughout the
  pipeline; all cohort metadata is fresh and attached alongside.

#### Import boundary

- Roster imports do **not** write review decisions.
- Review decisions are separate records, kept out of roster import payloads (see
  `docs/import-workflow.md`).
- Import preview and identity collision handling are **future Phase 5 work**, not
  part of Phase 4.

#### Prior-season boundary

- Prior seasons remain locked.
- Phase 4 does not unlock or mutate prior-season roster data;
  `audit.lockedSourceSeasonIds` records the prior seasons that stay locked.

#### Terminology confirmed

- **y-up** and **z-down** are cohort reclassification events, not ordinary team
  transfers.
- A y-up / z-down can persist while the player travels with the reclassified cohort
  (the preservation rule — see `## Y-Up / Z-Down`).
- **reset** is advisory unless a future approved workflow applies it. Through Phase
  4, a reset is only recommended (slice 4) or recorded as accepted (slices 6–8);
  nothing is actually reset.
- An **"active assignment"** is derived state (slice 5 `activeStatus` / slice 8
  effective state), not a roster mutation.

#### Transition to Phase 5

- Phase 5 should focus on **import preview and identity collision handling**.
- Phase 5 must preserve loaded roster authority.
- Phase 5 must not discard duplicate or ambiguous roster entries; ambiguity stays
  `unknown` and is surfaced for review rather than dropped.

### Player movement taxonomy alignment (Phase 3 slice 5)

This slice is a **spec alignment pass only**. It introduces no engine logic, no
UI, and no badges. Its purpose is to fix clear, non-conflicting vocabulary so the
later movement-classification coding slices build on shared terms. The
per-status definitions that follow this section (`## Returning`, `## New`,
`## Transfer / Move-In`, `## Y-Up / Z-Down`, `## Promotion`, `## Relegation`,
`## Lateral movement`) are the product-level target meanings; this section frames
how they relate to the two comparison foundations already built.

#### Two foundations, deliberately distinct

There are two separate prior-season comparison engines already in the codebase.
They answer different questions and must not be conflated:

1. **Same-slot roster comparison** — `comparePriorSeasonRosterComparison` /
   `summarizePriorSeasonRosterComparison` (slices 1–2). This compares a current
   team to the prior-season team occupying the **same team slot** (same
   `districtId` + `ageDivisionId` + `teamCode`). It answers: "for this one team
   slot, who came back, who is new to the slot, who did not return, and who is
   ambiguous?" Its supported buckets are `returning`, `newToRoster`,
   `notReturning`, and `unknown`. By design it compares only within a single team
   slot, so **it cannot detect transfers** — a player who left for a different
   slot simply reads as `notReturning` here, and a player who arrived from a
   different slot reads as `newToRoster`. That is correct for the same-slot
   question and is not a defect.

2. **Exact identity team-slot movement** — `detectExactPriorSeasonPlayerMovement`
   (slice 4). This compares exact identity keys across **all** current-season and
   prior-season team slots at once. It answers: "does this exact identity appear
   on the same team slot, a different team slot, only the current season, or only
   the prior season?" Its buckets are `sameTeamReturning`, `transferredIn`,
   `transferredOut`, `newToConference`, `notReturning`, and `unknown`.

This detector is a **deterministic foundation, not the final movement
taxonomy.** Its `transferredIn` / `transferredOut` buckets mean only "exact
identity on a different team slot." They are an **input signal**, not a final
product `Transfer` verdict, and not a promotion / relegation / lateral verdict.
The detector must not be described as if different-slot movement is always a
final transfer.

#### Product-level movement taxonomy

These are the product-facing meanings the richer classifier (future slices) will
produce. Several already have dedicated sections below; the table fixes the
canonical term and one-line meaning so all specs agree.

| Term | Canonical meaning | Status today |
| --- | --- | --- |
| same-team returning | Exact identity returns to the **same** team slot (same district + age division + team code). | Signal implemented (slice 4 `sameTeamReturning`); see `## Returning` for the fuller product rule. |
| new to roster | A current player not present on the **prior-season same team slot**. | Implemented for the same-slot comparison (slice 1 `newToRoster`). Slot-scoped, not conference-scoped. |
| new to conference | A current exact identity that appears on **no** prior-season team slot anywhere in the comparison set. | Signal implemented (slice 4 `newToConference`). |
| not returning | A prior-season identity that is absent from the current comparison set (slot-scoped in slice 1, conference-scoped in slice 4). | Implemented (slice 1 + slice 4). Comparison/summary context only; never a current player-card status. |
| exact team-slot movement | An exact identity whose prior match sits on a **different** team slot than its current slot. | Signal implemented (slice 4 `transferredIn` / `transferredOut`). Input signal only — see relationships below. |
| transfer / move-in | A prior-season match exists and the prior-season **district differs** from the current-season district. | Future. Defined in `## Transfer / Move-In`. Requires district context; not equal to exact team-slot movement. |
| promotion | Same district, expected age progression satisfied, current competitive tier **higher** than prior. | Future. Defined in `## Promotion`. Requires team-hierarchy interpretation. |
| relegation | Same district, expected age progression satisfied, current competitive tier **lower** than prior. | Future. Defined in `## Relegation`. Requires team-hierarchy interpretation. |
| lateral movement | Same district, expected age progression satisfied, current and prior competitive tiers **equivalent**. | Future. Defined in `## Lateral movement`. Requires team-hierarchy interpretation. |
| y-up | Cohort reclassification: player moves into a cohort path one age division **above** expected progression. | Future. Defined in `## Y-Up / Z-Down`. A cohort reclassification event, not an ordinary transfer. |
| z-down | Cohort reclassification: player moves into a cohort path one age division **below** expected progression. | Future. Defined in `## Y-Up / Z-Down`. A cohort reclassification event, not an ordinary transfer. |
| unknown / ambiguous identity | Identity key cannot be safely resolved (e.g. duplicate name on either side). | Implemented across slices. Never classified into a movement bucket. |

#### Relationship between terms

- **Exact team-slot movement is an input signal, not a verdict.** Detecting that
  an exact identity sits on a different team slot than last season is the raw
  signal. It is upstream of `transfer`, `promotion`, `relegation`, and
  `lateral movement`; it does not by itself decide which of those (if any)
  applies.
- **Promotion, relegation, and lateral movement require team-hierarchy
  interpretation.** They are only meaningful after the competitive hierarchy
  (`A(x) > B1 > C1 = B2 > B3+ = C2 = D2`) is applied to the prior and current team
  codes. The exact team-slot movement signal supplies the "moved" fact; the
  hierarchy supplies the direction.
- **Transfer / move-in requires district/team context and future business
  rules.** The product `Transfer` rule keys on a **district change**, not merely
  a different team code. Same-district different-slot movement is candidate
  promotion / relegation / lateral movement, not a transfer. Cross-district
  movement is candidate transfer. A single different-slot signal can therefore
  feed different final classifications depending on district context.
- **Y-up / z-down are cohort reclassification events, not ordinary team
  transfers.** They describe a player traveling with a cohort one division off
  the expected age progression, and (per `## Y-Up / Z-Down`) can persist across
  seasons. They must not be folded into transfer or promotion/relegation buckets.
- **Ambiguous identity keys stay `unknown` / review.** An ambiguous key (e.g. a
  duplicate name on either side) must never be classified into any movement
  bucket — not returning, not transfer, not promotion/relegation/lateral, not
  y-up/z-down. Ambiguity is resolved (if ever) only through future
  identity-collision review, which is out of scope here.

#### Guardrails for this and the next slice

- **No fuzzy matching yet.** All matching remains exact normalized-name identity
  keys via `getPlayerIdentityKey`.
- **No collision resolution yet.** Ambiguous identities remain `unknown`; no
  accept/reject/link/create-new behavior is introduced.
- **No UI labels or badges are implied by this spec pass.** Naming a product term
  here does not authorize rendering it on a player card or summary.
- **No mutation or suppression of roster records.** See `## Roster authority`.
  Movement classification is derived metadata only.
- **Prior seasons remain locked.** Aligning the taxonomy changes no season-lock
  behavior.

## Returning

A player is returning when the matched prior-season assignment is the same team or functionally same continuing roster path.

Initial strict rule:

- same player identity
- prior season exists
- same district
- expected age progression or Scout exception
- same competitive tier or team code, depending on configured comparison mode

## New

A player is new when no prior-season match exists.

## Transfer / Move-In

A player is a transfer when:

- a prior-season match exists
- prior-season district differs from current-season district

A player returning to a prior district after playing elsewhere should still be classified as a transfer for the current-season comparison.

## Y-Up / Z-Down

Y-up and z-down should be treated primarily as a cohort reclassification event discovered during year-over-year review, not as a field that must be recalculated from birthdate every season.

### Initial detection

The system should flag a y-up or z-down when a player appears to move into a cohort path that is one age division above or below the expected age progression.

Examples:

```text
Expected: 2025 GR -> 2026 PW
Observed: 2025 GR -> 2026 GR
Possible z-down / repeat cohort
```

```text
Expected: 2025 GR -> 2026 PW
Observed: 2025 GR -> 2026 MM
Possible y-up
```

### Preservation rule

Once a player is identified as y-up or z-down, that reclassification status should be preserved while the player continues traveling with the newly established cohort path.

In other words, the first reclassification year creates a cohort offset. Later years should carry that offset forward if the player progresses with that cohort.

### Reset / review conditions

The app should require review or reset the preserved cohort offset when:

- the player skips a season
- the player changes district and identity confidence is low
- the player moves more than one division away from the preserved cohort path
- the player stops following the expected annual progression for the preserved cohort

### Restrictions

- maximum one division removed from original age cohort
- never more than one year removed from original age cohort

Known special cases:

- Scout is an official two-year age band.
- Bantam includes 13- and 14-year-olds.
- A 14-year-old Bantam may be treated as a preserved z-down case when the historical cohort path supports that interpretation.

Open item: the app does not need birthdate for basic one-time detection and preservation. However, if birthdate or explicit age is later available, it can improve validation and reduce false positives.

## Promotion

A player is promoted when:

- prior-season match exists
- same district
- expected age progression is satisfied, including any preserved y-up/z-down cohort offset
- current team competitive rank is higher than prior team competitive rank

Example:

```text
B2 -> B1
```

## Relegation

A player is relegated when:

- prior-season match exists
- same district
- expected age progression is satisfied, including any preserved y-up/z-down cohort offset
- current team competitive rank is lower than prior team competitive rank

Example:

```text
B1 -> B2
```

## Lateral movement

A player has lateral movement when:

- prior-season match exists
- same district
- expected age progression is satisfied, including any preserved y-up/z-down cohort offset
- current and prior competitive ranks are equivalent

Example:

```text
C2 -> D2
```

## Roster authority

Loaded roster records are authoritative.

- Duplicate or ambiguous player names must remain visible and preserved in the roster.
- Ambiguity affects derived metadata only — such as identity confidence and roster status — never the source roster record.
- Derived logic must not alter, remove, suppress, merge, nullify, rewrite, or ignore a rostered player record because of duplication or ambiguity.

## Identity confidence

Initial matching is name-based.

### High confidence

A player match is high confidence when:

- exact or normalized name match exists
- no competing same-name match creates ambiguity under the low-confidence conditions

### Low confidence condition 1

Player was not in the same district in the prior season, and the same named match exists in another district.

### Low confidence condition 2

Two or more matching names exist in the same district.

## Import collision behavior

During roster import, collisions should be surfaced with:

- proposed match
- confidence status
- reason codes
- user override action

The user can:

- accept proposed match
- reject proposed match
- manually link to an existing person
- create a new person

### Import preview identity match candidates (Phase 5 slice 2)

Phase 5 slice 2 adds the first derived layer of the collision workflow above:
**candidate identity matching** (`createRosterImportPreviewIdentityMatches`,
`src/engine/rosterImportPreviewIdentityMatch.ts`). It consumes the slice 1 preview
rows plus a set of existing roster identity records and produces, per preview row,
the existing records it might correspond to — the "proposed match / confidence /
reason codes" inputs the collision UI will later present. It is **candidate
generation only**: it does not resolve collisions, capture user decisions, or apply
imports.

Contract:

- **Only `ready` rows are matched.** `invalid` rows become
  `skipped-invalid-preview-row` and `needs-review` rows become
  `skipped-review-preview-row`; both are preserved, never dropped.
- **Exact normalized identity key only.** Matching reuses the Phase 2
  `getPlayerIdentityKey` helper — no fuzzy matching, no nickname inference, no
  prior-season comparison. One existing match -> `single-candidate`; more than one
  -> `multiple-candidates` (review); none -> `no-match`.
- **Jersey assists, never decides.** A matching jersey number adds a
  `matching-jersey-number` reason and raises confidence one notch within an
  exact-name candidate group (capped at `high`). It never creates a match on its
  own — different names that share a jersey number do not match.
- **Ambiguity becomes review metadata.** Duplicate existing names
  (`existing-duplicate-name`, `same-name-duplicate-existing`, confidence `low`) and
  duplicate ready-preview names (`preview-duplicate-name`,
  `same-name-duplicate-preview`, confidence `low`) are flagged for review, never
  discarded. A clean single match is `exact-identity-key` at `high` confidence.
- **Deterministic ordering.** Entries follow preview row order; candidates follow
  existing-record input order.
- **No throwing on bad input.** An existing record with a missing/blank name is
  reported as a result-level `invalid-existing-record` issue and excluded from
  matching only.

`getRosterImportPreviewIdentityMatchesReadyForApply` returns only unambiguous
single high-confidence entries with no review issues (a candidate set for a future
apply workflow); `getRosterImportPreviewIdentityMatchesNeedingReview` returns
multiple-candidate entries and any entry carrying a warning/error issue. Roster
authority holds throughout: existing records and preview rows are referenced, never
mutated. Collision resolution, user decisions, and import apply remain later
Phase 5 work.

### Import identity review decision contract (Phase 5 slice 3)

Phase 5 slice 3 captures the reviewer's choice from the collision workflow above as
an append-only **decision** (`src/engine/rosterImportIdentityReviewDecision.ts`).
It mirrors the Phase 4 action -> decision sequencing and is **decision capture
only**: no collision resolution, no import apply, no repository, no persistence, no
UI, and no roster mutation. A decision is a future-facing instruction a later apply
step will consume.

Action validation (`applyRosterImportIdentityReviewAction(entry, action)`):

- **Allowed actions depend on entry status.** `no-match` allows create-new /
  manual-link / defer; `single-candidate` and `multiple-candidates` allow
  accept-candidate / reject-candidates / manual-link / create-new / defer;
  `skipped-invalid-preview-row` and `skipped-review-preview-row` allow defer only.
- **Required targets.** `accept-candidate` needs a `selectedExistingRecordId` that
  is one of the entry's candidates; `manual-link` needs a `manualExistingRecordId`.
  Every action needs a stable `previewSourceRowId` (a row with no stable id cannot
  carry a decision).
- **Effects are future-apply instructions.** accept-candidate / manual-link ->
  `link-to-existing`; reject-candidates -> `reject-import-row` (rejects the
  interpretation for now, never a deletion); create-new -> `create-new-roster-entry`
  (no entry is created here); defer -> `defer-review`. A rejected action has effect
  `no-effect`.

Decision creation (`createRosterImportIdentityReviewDecision(actionResult,
options)`): only an **accepted** result becomes a decision; rejected results are
refused. `decisionId` / `createdAt` / `reviewedAt` are caller-provided (the helper
never generates ids, never calls `Date.now()`, and never infers user identity).
Decisions are append-only — supersession is recorded only via
`audit.supersedesDecisionId`, and no prior decision is removed or rewritten.
`validateRosterImportIdentityReviewDecision` enforces required keys, valid
action/effect, their coherence, and that a `link-to-existing` decision carries a
target; `summarizeRosterImportIdentityReviewDecisions` counts by action, effect,
supersession, note, and validity. Applying decisions to an import, a decision
repository, and the review UI remain later Phase 5 work.

### Import identity review decision repository (Phase 5 slice 4)

Phase 5 slice 4 adds the narrow repository / storage-boundary layer for the slice 3
decisions (`src/engine/rosterImportIdentityReviewDecisionRepository.ts`), mirroring
the Phase 4 slice 9 cohort decision repository. The state shape is
`{ version, decisions }` and every operation is pure: it returns a new state and
never mutates the prior state, the decision objects, or any roster / preview /
existing-record data. There is no `Date.now()`, no generated ids, and no real
persistence (no localStorage / IndexedDB / file write).

- **Append-only.** `appendRosterImportIdentityReviewDecision(s)` validate each
  decision via `validateRosterImportIdentityReviewDecision` and reject invalid
  (`invalid-decision`) and duplicate-`decisionId` (`duplicate-decision-id`)
  records. Duplicates are caught against existing state and earlier batch entries;
  batch order is preserved.
- **Active vs history.** `getRosterImportIdentityReviewDecisions` returns the full
  append-ordered history; `getActiveRosterImportIdentityReviewDecisions` excludes
  decisions superseded via another decision's `audit.supersedesDecisionId`.
  Superseded decisions are never removed from history.
- **Export / import.** `exportRosterImportIdentityReviewDecisionRepository` returns a
  JSON-compatible `{ version, decisions }` payload;
  `importRosterImportIdentityReviewDecisionRepository` validates the envelope
  (`invalid-repository-payload` / `unsupported-repository-version` /
  `missing-decision-list`) then each decision, performing a partial import (`ok` is
  false if anything was rejected) without mutating the payload.

Wiring this repository to actual local storage, applying decisions to an import, and
the review UI remain later Phase 5 work.

### Applying import identity review decisions (Phase 5 slice 5)

Phase 5 slice 5 resolves slice 2 match entries against the active slice 3 decisions
in memory, computing the **effective import outcome per row**
(`applyRosterImportIdentityReviewDecisionsToMatches`,
`src/engine/rosterImportIdentityReviewDecisionApplication.ts`), mirroring the
Phase 4 slice 8 application step. It is **effective-state computation only**: no
import apply/commit, no roster write, no record creation/linking, no row deletion,
no persistence, and no UI. Each outcome is a future-apply instruction; source
entries and decisions are referenced, never mutated.

- **Match key.** `previewSourceRowId` + `previewRowIndex`. Entries are emitted in
  input order; ignored decisions in decision input order.
- **Effective outcomes.** `unresolved`, `link-to-existing`, `create-new`,
  `rejected`, `deferred`, `skipped-invalid-preview-row`,
  `skipped-review-preview-row`, `conflict`.
- **No decision -> unresolved.** A matchable entry with no applicable decision is
  `unresolved`; a high-confidence single candidate is never auto-linked.
- **Applied mapping.** accept-candidate / manual-link -> `link-to-existing`;
  create-new -> `create-new`; reject-candidates -> `rejected` (rejects the
  interpretation, not the row); defer -> `deferred`.
- **Skipped rows.** Always resolve to their skip outcome; any matching decision is
  ignored with `decision-entry-status-mismatch`.
- **Conflict.** Two or more current decisions for one entry -> `conflict`, none
  applied.
- **Ignored decisions.** Decisions are validated via
  `validateRosterImportIdentityReviewDecision`; superseded decisions (via
  `audit.supersedesDecisionId`) are ignored. Reasons: `invalid-decision`,
  `superseded-decision`, `missing-preview-row-key`, `no-matching-entry`,
  `duplicate-current-decision`, `decision-entry-status-mismatch`,
  `selected-candidate-not-found` (an accept-candidate whose selected record is no
  longer among the entry's candidates).

`summarizeAppliedRosterImportIdentityReviewDecisions` counts outcomes, confidences,
and ignored reasons. Actually applying outcomes to the roster (import commit) and
the review UI remain later Phase 5 / Phase 6 work.

### Import commit preview / dry-run plan (Phase 5 slice 6)

Phase 5 slice 6 folds the slice 5 applied outcomes into a deterministic **dry-run
commit plan** (`createRosterImportCommitPreviewPlan`,
`src/engine/rosterImportCommitPreviewPlan.ts`): per row, what a future commit would
do, and what blocks it. It is **planning only** — no import apply/commit, no roster
write, no record creation/linking, no row deletion, no persistence, no UI. A
`ready-to-link` / `ready-to-create` row is a future intended operation; source
applied entries are referenced (`originalAppliedEntry`), never mutated.

- **Outcome -> plan mapping.** link-to-existing with a target id ->
  `ready-to-link` / `link-existing-record`; link-to-existing with no target id ->
  `blocked-unresolved` (blocker `missing-target-existing-record-id`); create-new ->
  `ready-to-create` / `create-new-roster-entry`; rejected -> `rejected` /
  `reject-import-row`; deferred -> `deferred` / `defer-review`; unresolved ->
  `blocked-unresolved` (blocker `unresolved-identity`); conflict ->
  `blocked-conflict` (blocker `conflicting-decisions`); skipped-invalid ->
  `blocked-invalid-preview-row`; skipped-review -> `blocked-review-preview-row`.
- **Commit gating.** `canCommit` is true only with at least one row, no `blocked-*`
  rows, and a complete (or absent) target context. Rejected and deferred rows are
  explicit reviewer outcomes and do **not** block; an empty plan is `canCommit:
  false`. An incomplete provided target context adds a result-level
  `invalid-target-context` blocker and makes `canCommit` false without mutating rows.
- **No auto-link.** Unresolved identities — including high-confidence single
  candidates — block rather than auto-linking.

`summarizeRosterImportCommitPreviewPlanRows` tallies statuses, planned operations,
blockers, and a row-level `canCommit`;
`getRosterImportCommitPreviewPlanRowsReadyForCommit` and
`getRosterImportCommitPreviewPlanRowsBlockingCommit` filter the rows. Performing the
commit and the review UI remain later Phase 5 / Phase 6 work.

### Phase 5 checkpoint: import preview and identity collision pipeline (Phase 5 slice 7)

Phase 5 slices 1–6 are **complete / checkpointed**. Together they build one
engine-only, pure-and-deterministic import pipeline that stages candidate roster
rows, generates identity match candidates against existing roster records, captures
an append-only reviewer decision, stores those decisions in a local
storage-boundary repository, resolves decisions against matches into an effective
in-memory outcome per row, and folds those outcomes into a dry-run commit preview
plan. This slice adds **no product logic**; it confirms the contracts and the layer
boundaries before any future import application / projection slice. It mirrors the
Phase 4 slice 10 checkpoint.

#### End-to-end pipeline

The data flows in one direction, each stage layered on top of the previous one
(never folded into it). Every stage lives in `src/engine/` and is covered by a
matching `src/test/` suite.

1. **Import preview rows** — `createRosterImportPreview`
   (`rosterImportPreview.ts`). Stages each candidate roster row into a
   non-destructive preview row (input order, deterministic `rowIndex`, original
   `playerName`, `normalizedIdentityKey`, preserved passthrough `fields`, per-row
   `issues`, and a `status` of `ready` / `needs-review` / `invalid`). Every input
   row is preserved; ambiguity affects metadata only. No file parsing, no
   comparison against existing rosters.
2. **Identity match candidates** — `createRosterImportPreviewIdentityMatches`
   (`rosterImportPreviewIdentityMatch.ts`). Produces, per ready preview row, the
   existing roster records it might correspond to (`no-match` /
   `single-candidate` / `multiple-candidates`), with skipped entries for
   `invalid` / `needs-review` rows. Exact normalized identity key only; jersey
   assists but never decides. Candidate generation only — no resolution.
3. **Review action + decision contract** —
   `applyRosterImportIdentityReviewAction` -> `createRosterImportIdentityReviewDecision`
   (`rosterImportIdentityReviewDecision.ts`). Validates what a reviewer may do with
   a match entry and captures an **accepted** choice as an append-only
   `RosterImportIdentityReviewDecision` (a future-apply instruction). Ids and
   timestamps are caller-provided; supersession is recorded only via
   `audit.supersedesDecisionId`.
4. **Decision repository / storage boundary** —
   `rosterImportIdentityReviewDecisionRepository.ts`. Models the local data
   boundary (`{ version, decisions }`) with pure append / load / active-view /
   export / import helpers. An in-memory adapter plus a JSON-compatible
   export/import contract — not real persistence.
5. **Effective decision application** —
   `applyRosterImportIdentityReviewDecisionsToMatches`
   (`rosterImportIdentityReviewDecisionApplication.ts`). Resolves match entries
   against the active decisions in memory, computing an effective outcome per row
   (`unresolved` / `link-to-existing` / `create-new` / `rejected` / `deferred` /
   `skipped-*` / `conflict`). No decision -> `unresolved`; a high-confidence single
   candidate is never auto-linked. Conflicting current decisions are never resolved
   by array order.
6. **Dry-run commit preview plan** — `createRosterImportCommitPreviewPlan`
   (`rosterImportCommitPreviewPlan.ts`). Folds applied outcomes into a per-row plan
   (`planStatus` + `plannedOperation` + `targetExistingRecordId` + `reasons` +
   `blockers`) and a top-level `canCommit` readiness gate. `ready-to-link` /
   `ready-to-create` are future intended operations, never writes.

#### The distinct data layers

Phase 5 keeps these layers strictly separate, and the data model must not collapse
them (see `docs/data-model.md`, "Phase 5 checkpoint: import pipeline layers"):

1. **Loaded authoritative roster data** — `Player`, `Player Season Assignment`,
   `Team`, and the existing roster identity records supplied to matching. Loaded
   and authoritative.
2. **Import preview rows** — staged candidate rows (slice 1). Not roster records.
3. **Identity match entries** — per-row candidate metadata against existing records
   (slice 2). Not a resolution, not a decision.
4. **Review actions** — a validated reviewer intent against one match entry
   (slice 3). Not yet a stored decision.
5. **Append-only review decisions** — the captured `RosterImportIdentityReviewDecision`
   records (slice 3). Separate records, never roster rows.
6. **Decision repository state** — the local `{ version, decisions }` boundary
   (slice 4). In-memory model + JSON export/import only.
7. **Applied / effective outcome entries** — the in-memory per-row effective
   outcome (slice 5). Derived state, not a write.
8. **Dry-run commit preview plan rows** — the per-row planned operation and
   blockers plus the top-level `canCommit` gate (slice 6). A plan, not a commit.

#### Hard roster authority rule (carried forward, unchanged)

- Loaded roster records remain authoritative (see `## Roster authority`).
- Import preview, matching, decisions, application, and the commit plan must never
  alter, remove, suppress, merge, nullify, rewrite, reorder, or ignore rostered
  names.
- Duplicate or ambiguous names affect **metadata / review state only**.
- Invalid, duplicate, skipped, rejected, and deferred import rows remain preserved
  as rows throughout the pipeline — nothing is dropped, and source objects are
  referenced (never mutated) at every stage.

#### Phase 5 is pure and deterministic

Across the whole pipeline so far there is:

- no file parsing;
- no file upload;
- no browser persistence;
- no `localStorage`;
- no `IndexedDB`;
- no React state wiring;
- no UI;
- no sample-data mutation;
- no roster mutation;
- no import apply / commit.

Ids and timestamps are always caller-provided, so output is fully reproducible.

#### Append-only decision semantics

- Review decisions are **append-only**.
- Superseded decisions remain in repository history (referenced by
  `audit.supersedesDecisionId`); they are never overwritten or removed.
- The active view excludes superseded decisions only.
- Decisions can influence derived **effective outcomes only** (via slice 5
  application); they never mutate preview rows, match entries, roster records, or
  sample data.

#### Dry-run plan semantics

- `ready-to-link` and `ready-to-create` are **future intended operations only** —
  no record is linked or created.
- `rejected` and `deferred` rows remain preserved (an explicit reviewer outcome,
  not a deletion); they do **not** block commit.
- `blocked-*` rows prevent commit availability.
- **No decision means `unresolved`**, which blocks.
- A high-confidence single candidate is **never** auto-linked.
- Top-level `canCommit` is the **authoritative readiness gate** (`summary.canCommit`
  is row-level only and ignores target context).

#### Terminology confirmed

- **"commit preview plan"** means the **dry-run plan only**.
- **"ready-to-create"** does **not** create a roster entry.
- **"ready-to-link"** does **not** link records.
- **"rejected"** does **not** delete an import row.
- **"deferred"** keeps review pending.
- **"blocked"** prevents future commit availability until resolved.

#### Boundary for the next possible slice

- A future slice **may** produce a pure in-memory import **application / projection**
  from a committable plan.
- That projection **may** describe the resulting roster additions / links, but it
  must still **not** persist, mutate sample data, parse files, or wire UI unless
  explicitly approved.
- Actual browser persistence, CSV / file parsing, and the review UI remain separate
  later slices.

### Import application / projection (Phase 5 slice 8)

Phase 5 slice 8 adds a pure, deterministic **in-memory import application /
projection** (`createRosterImportApplicationProjection`,
`src/engine/rosterImportApplicationProjection.ts`). It consumes a **committable**
slice 6 dry-run commit preview plan plus existing roster records and computes, per
plan row, the roster link / addition a future apply **would** produce. It is
**projection only**: no import apply/commit, no roster write, no record
creation/linking, no row deletion, no persistence, no browser storage, no file
parsing, and no UI. No write/apply function is exported. It does not compare against
prior seasons or derive roster movement, and it does not change player matching
rules.

- **Gating.** Projection proceeds only when `plan.canCommit` is true. A
  non-committable plan returns `ok: false` with a result-level `plan-not-committable`
  blocker and no projected rows. A defensively-present `blocked-*` plan row is
  projected as `blocked` and forces `ok: false` even if `plan.canCommit` claims true.
- **Projection outcomes (one per plan row, in plan order).** `projected-link`,
  `projected-create`, `projected-reject`, `projected-defer`, `blocked`, `skipped`.
- **ready-to-link** -> `projected-link` only when its `targetExistingRecordId`
  resolves to exactly one existing record; otherwise `blocked` with
  `invalid-plan-row` (no target id on the row), `missing-existing-record` (no match),
  or `duplicate-existing-record-id` (2+ matches). A link never modifies the existing
  record.
- **ready-to-create** -> `projected-create` with a minimal, provisional
  `projectedNewRecord` (deterministic `provisionalRecordId` from target context +
  `previewSourceRowId` + `previewRowIndex`); blocked with `missing-target-context`,
  `missing-preview-row-key`, or `missing-player-name-for-create` when those are
  absent. The projected record is in-memory only and is never persisted; jersey /
  grade are intentionally not chased through raw objects.
- **rejected / deferred** -> `projected-reject` / `projected-defer` by default
  (preserved, nothing deleted); optional `allowRejectedRows: false` /
  `allowDeferredRows: false` project them as `skipped` (`skipped-non-committed-row`).
- **`ok`** is true only when the plan is committable, there are no result-level
  blockers, and no projected row carries a blocker.

Blocker codes: `plan-not-committable`, `missing-existing-record`,
`duplicate-existing-record-id`, `blocked-plan-row`, `invalid-plan-row`,
`missing-target-context`, `missing-preview-row-key`, `missing-player-name-for-create`.
Reason codes: `linked-to-existing-record`, `projected-new-roster-entry`,
`reviewer-rejected`, `reviewer-deferred`, `blocked-by-plan`,
`skipped-non-committed-row`.

`summarizeRosterImportApplicationProjection` tallies outcomes, blockers, and a
row-level `ok` (the result's top-level `ok` is authoritative, additionally requiring
plan committability and no result-level blockers — mirroring the slice 6 `canCommit`
split). `getRosterImportApplicationProjectionLinkedRows`,
`getRosterImportApplicationProjectionNewRows`, and
`getRosterImportApplicationProjectionSkippedRows` (reject / defer / skipped) filter
the rows. Roster authority holds throughout: the plan, its rows, the original applied
entries, and existing records are referenced, never mutated. Actually applying the
projection (the real import apply / commit), persistence, file parsing, and the
review UI remain later work and require explicit approval.

## Coach lifetime record

Coach lifetime record accumulates all team wins and losses for teams where the coach was assigned.

This applies across:

- seasons
- districts
- age divisions
- teams

## Coach continuous-cohort record

Continuous-cohort record accumulates only when a coach remains with the same district and the expected age progression.

Continues:

```text
2024 GR -> 2025 PW
```

Resets:

```text
2024 PW -> 2025 PW
```

Resets when:

- district changes
- skipped season occurs
- age progression breaks

Scout exception:

```text
2024 SC -> 2025 SC
```

This may remain continuous because Scout covers a two-year band.

## Game-derived records

Team records should be derived from game objects.

A team record should include:

- wins
- losses
- winning percentage
- playoff wins
- playoff losses
- championship appearances
- championship wins

A game marked `isChampionship: true` is also expected to be a playoff game unless the data source indicates otherwise.
