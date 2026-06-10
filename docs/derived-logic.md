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
B1 > C1 > B2 > B3+ = C2 = D2
```

Where:

- `B3+` means B3, B4, B5, and any lower B-numbered team.
- `B3+`, `C2`, and `D2` are equivalent competitive tiers.

A first pass ranking map:

```json
{
  "B1": 400,
  "C1": 300,
  "B2": 200,
  "B3_PLUS": 100,
  "C2": 100,
  "D2": 100
}
```

Open item: determine how `A1`, `A2`, `A3`, and `A4` should participate in promotion/relegation logic, because A-codes describe first-drafted teams but also encode division size.

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
