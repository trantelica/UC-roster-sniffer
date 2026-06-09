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
