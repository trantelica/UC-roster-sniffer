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
