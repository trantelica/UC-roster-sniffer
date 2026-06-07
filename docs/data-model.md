# Data Model

This document defines the initial conceptual data model. Field names are draft-level and may be normalized during implementation.

## Season

```json
{
  "seasonId": "2026",
  "label": "2026",
  "status": "active",
  "locked": false
}
```

### Notes

- Prior seasons should be locked.
- Active seasons may receive roster imports, schedule updates, and result updates.

## District

```json
{
  "districtId": "alta",
  "name": "Alta",
  "mascot": "Hawks",
  "logoAssetPath": "assets/districts/alta/logo.png",
  "helmetAssetPath": "assets/districts/alta/helmet.png",
  "primaryColor": "#000000",
  "secondaryColor": "#FFFFFF"
}
```

### Notes

- Districts are standardized.
- District branding is reusable across seasons.

## Age Division

```json
{
  "ageDivisionId": "GR",
  "name": "Gremlin",
  "leagueLabel": "GR League 9",
  "ordinal": 2,
  "typicalAges": [9]
}
```

### Fixed order

```text
SC -> GR -> PW -> MM -> GI -> BA
```

## Team

```json
{
  "teamId": "2026-alta-GR-B1",
  "seasonId": "2026",
  "districtId": "alta",
  "ageDivisionId": "GR",
  "teamCode": "B1",
  "draftOrder": 2,
  "divisionTeamCount": 4,
  "headCoachId": "coach-jane-smith",
  "assistantCoachIds": ["coach-sam-lee"],
  "isMyTeam": false
}
```

### Notes

- `teamCode` follows conference team classification rules.
- `divisionTeamCount` is the number of teams in that district-age-division for the season.
- `isMyTeam` is season-specific.

## Player

```json
{
  "playerId": "player-generated-id",
  "canonicalName": "Jordan Smith",
  "notes": "Free text notes.",
  "cohortOffsetStatus": "zDown",
  "cohortOffsetFirstSeasonId": "2026",
  "cohortOffsetSource": "yearOverYearReview"
}
```

### Notes

- Player identity is name-based at import, then can be linked to a canonical `playerId`.
- Collisions should be surfaced during import.
- `cohortOffsetStatus` is optional and records a preserved y-up or z-down classification once identified.
- Y-up/z-down is treated as a cohort reclassification event that can persist while the player continues with the reclassified cohort.

### Cohort offset values

```text
none
yUp
zDown
```

### Cohort offset source values

```text
yearOverYearReview
explicitImport
manualOverride
```

## Player Season Assignment

```json
{
  "assignmentId": "2026-player-generated-id-alta-GR-B1",
  "seasonId": "2026",
  "playerId": "player-generated-id",
  "playerNameRaw": "Jordan Smith",
  "districtId": "alta",
  "ageDivisionId": "GR",
  "teamId": "2026-alta-GR-B1",
  "derivedStatus": "returning",
  "identityConfidence": "high",
  "cohortOffsetStatusForSeason": "zDown",
  "cohortOffsetReviewRequired": false
}
```

### Notes

- A player may have only one assignment per season.
- The assignment carries season-specific roster context.
- `cohortOffsetStatusForSeason` allows the UI to show that a preserved y-up or z-down classification applies to the current assignment.
- `cohortOffsetReviewRequired` should be true when the preserved cohort path appears broken or ambiguous.

## Coach

```json
{
  "coachId": "coach-generated-id",
  "canonicalName": "Jane Smith"
}
```

## Coach Season Assignment

```json
{
  "assignmentId": "2026-coach-jane-smith-alta-GR-B1-head",
  "seasonId": "2026",
  "coachId": "coach-generated-id",
  "coachNameRaw": "Jane Smith",
  "districtId": "alta",
  "ageDivisionId": "GR",
  "teamId": "2026-alta-GR-B1",
  "role": "headCoach"
}
```

### Role values

```text
headCoach
assistantCoach
```

## Game

```json
{
  "gameId": "2026-alta-GR-B1-week-01",
  "seasonId": "2026",
  "teamId": "2026-alta-GR-B1",
  "opponentTeamId": "2026-brighton-GR-B1",
  "weekLabel": "Week 1",
  "gameDate": "2026-08-22",
  "homeAway": "home",
  "teamScore": 20,
  "opponentScore": 14,
  "result": "win",
  "isPlayoff": false,
  "isChampionship": false
}
```

### Notes

- Opponents are existing teams.
- No separate opponent object is needed.
- Records should derive from game objects.

## Identity Match Decision

```json
{
  "decisionId": "import-2026-001-player-jordan-smith",
  "importId": "import-2026-001",
  "entityType": "player",
  "rawName": "Jordan Smith",
  "proposedEntityId": "player-generated-id",
  "confidence": "low",
  "reasons": ["same_name_exists_other_district"],
  "userDecision": "accepted"
}
```

### Confidence values

```text
high
low
```

### User decision values

```text
accepted
rejected
manualLink
createNew
```

## Import Batch

```json
{
  "importId": "import-2026-rosters-001",
  "importType": "roster",
  "seasonId": "2026",
  "createdAt": "2026-06-07T00:00:00Z",
  "status": "completed"
}
```

### Import types

```text
roster
schedule
result
branding
```
