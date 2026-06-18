import { describe, it, expect } from 'vitest';
import type { Team } from '../domain/types';
import {
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
  getUteScrapedJsonImportSessionSelectableTargets,
} from '../engine/uteConferenceScrapedJsonImportSession';
import {
  buildScrapedJsonImportRosterAwareReview,
  type ScrapedImportReviewDecisionMap,
} from '../engine/uteConferenceScrapedJsonImportRosterAwareReview';

// ---------------------------------------------------------------------------
// Fixtures: a scraped 2026 alta GR B1 player source + a controllable existing team.
// ---------------------------------------------------------------------------

function playerPayload(playerNames: string[]) {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: '2026 Fall Season',
      age_division: 'GR League 9',
      age_division_alias: 'GR',
      year: 2026,
      record_type: 'players',
      source_url: 'https://ute.example/2026/gr',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GR League 9',
        teams_count: 1,
        teams: [
          {
            team_name: 'Gremlin B1',
            source_url: 'https://ute.example/2026/gr/b1',
            players_count: playerNames.length,
            players: playerNames.map((name) => ({ name })),
          },
        ],
      },
    ],
  };
}

function coachPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: '2026 Fall Season',
      age_division: 'GR League 9',
      age_division_alias: 'GR',
      year: 2026,
      record_type: 'coaches',
      source_url: 'https://ute.example/2026/gr/coaches',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GR League 9',
        teams_count: 1,
        teams: [
          {
            team_name: 'Gremlin B1',
            source_url: 'https://ute.example/2026/gr/b1',
            coaches_count: 1,
            coaches: [{ name: 'Coach One', title: 'Head Coach' }],
          },
        ],
      },
    ],
  };
}

function existingTeam(playerNames: string[]): Team {
  return {
    teamId: '2026-alta-GR-B1',
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId: 'GR',
    teamCode: 'B1',
    draftOrder: 1,
    divisionTeamCount: 1,
    headCoach: null,
    assistantCoaches: [],
    players: playerNames.map((name) => ({ name })),
  };
}

function selectedSession(payload: unknown) {
  const loaded = createUteScrapedJsonImportSessionFromPayload(payload);
  const id = getUteScrapedJsonImportSessionSelectableTargets(loaded)[0].sourceTargetId;
  return selectUteScrapedJsonImportSessionTarget(loaded, id);
}

function rowByName(
  review: ReturnType<typeof buildScrapedJsonImportRosterAwareReview>,
  name: string
) {
  if (!review.available) throw new Error('review unavailable');
  return review.rows.find((r) => r.playerName === name)!;
}

const TEAMS = [existingTeam(['Jordan Smith', 'Taylor Johnson'])];
const TEAMS_WITH_DUP = [existingTeam(['Jamie Park', 'Jamie Park', 'Jordan Smith'])];

describe('roster-aware import review', () => {
  it('1. imported player with no existing match is classified as likely new', () => {
    const review = buildScrapedJsonImportRosterAwareReview(
      selectedSession(playerPayload(['Brand New'])),
      TEAMS
    );
    expect(rowByName(review, 'Brand New').matchStatus).toBe('likely-new');
  });

  it('2. imported player with exact existing match is classified as likely existing', () => {
    const review = buildScrapedJsonImportRosterAwareReview(
      selectedSession(playerPayload(['Jordan Smith'])),
      TEAMS
    );
    const row = rowByName(review, 'Jordan Smith');
    expect(row.matchStatus).toBe('likely-existing');
    expect(row.confirmable).toBe(true);
    expect(row.candidates[0].existingPlayerName).toBe('Jordan Smith');
  });

  it('3. duplicate existing roster names produce an ambiguous/collision state', () => {
    const review = buildScrapedJsonImportRosterAwareReview(
      selectedSession(playerPayload(['Jamie Park'])),
      TEAMS_WITH_DUP
    );
    const row = rowByName(review, 'Jamie Park');
    expect(row.matchStatus).toBe('ambiguous');
    expect(row.candidates.length).toBe(2);
    expect(row.confirmable).toBe(false);
  });

  it('4. duplicate imported names do not suppress or remove rows', () => {
    const review = buildScrapedJsonImportRosterAwareReview(
      selectedSession(playerPayload(['Sam Twin', 'Sam Twin'])),
      TEAMS
    );
    if (!review.available) throw new Error('unavailable');
    const twins = review.rows.filter((r) => r.playerName === 'Sam Twin');
    expect(twins.length).toBe(2); // both rows preserved
  });

  it('5. confirm-match decision updates dry-run as projected link', () => {
    const session = selectedSession(playerPayload(['Jordan Smith']));
    const review0 = buildScrapedJsonImportRosterAwareReview(session, TEAMS);
    const rowId = rowByName(review0, 'Jordan Smith').sourceRowId!;
    const decisions: ScrapedImportReviewDecisionMap = { [rowId]: 'confirm-match' };
    const review = buildScrapedJsonImportRosterAwareReview(session, TEAMS, decisions);
    const row = rowByName(review, 'Jordan Smith');
    expect(row.outcome).toBe('projected-link');
    expect(row.linkTargetExistingName).toBe('Jordan Smith');
  });

  it('6. create-new decision updates dry-run as projected create', () => {
    const session = selectedSession(playerPayload(['Jordan Smith']));
    const review0 = buildScrapedJsonImportRosterAwareReview(session, TEAMS);
    const rowId = rowByName(review0, 'Jordan Smith').sourceRowId!;
    const review = buildScrapedJsonImportRosterAwareReview(session, TEAMS, {
      [rowId]: 'create-new',
    });
    expect(rowByName(review, 'Jordan Smith').outcome).toBe('projected-create');
  });

  it('7. needs-review decision updates dry-run as deferred', () => {
    const session = selectedSession(playerPayload(['Jordan Smith']));
    const review0 = buildScrapedJsonImportRosterAwareReview(session, TEAMS);
    const rowId = rowByName(review0, 'Jordan Smith').sourceRowId!;
    const review = buildScrapedJsonImportRosterAwareReview(session, TEAMS, {
      [rowId]: 'needs-review',
    });
    expect(rowByName(review, 'Jordan Smith').outcome).toBe('deferred');
  });

  it('8. unresolved ambiguous rows block a committable dry-run', () => {
    const review = buildScrapedJsonImportRosterAwareReview(
      selectedSession(playerPayload(['Jamie Park', 'Brand New'])),
      TEAMS_WITH_DUP
    );
    if (!review.available) throw new Error('unavailable');
    expect(rowByName(review, 'Jamie Park').outcome).toBe('blocked-unresolved');
    expect(review.summary.canCommit).toBe(false);
    expect(review.summary.unresolvedRows).toBeGreaterThan(0);
  });

  it('9. clearing a decision restores the derived unresolved state', () => {
    const session = selectedSession(playerPayload(['Jordan Smith']));
    const review0 = buildScrapedJsonImportRosterAwareReview(session, TEAMS);
    const rowId = rowByName(review0, 'Jordan Smith').sourceRowId!;
    const withConfirm = buildScrapedJsonImportRosterAwareReview(session, TEAMS, {
      [rowId]: 'confirm-match',
    });
    expect(rowByName(withConfirm, 'Jordan Smith').outcome).toBe('projected-link');
    // Clearing = empty decision map again.
    const cleared = buildScrapedJsonImportRosterAwareReview(session, TEAMS, {});
    expect(rowByName(cleared, 'Jordan Smith').outcome).toBe('blocked-unresolved');
  });

  it('12. raw imported player names are preserved exactly', () => {
    const review = buildScrapedJsonImportRosterAwareReview(
      selectedSession(playerPayload(['Cary, Hudson', 'Moyer , Knox'])),
      TEAMS
    );
    if (!review.available) throw new Error('unavailable');
    expect(review.rows.map((r) => r.playerName)).toEqual(['Cary, Hudson', 'Moyer , Knox']);
  });

  it('13. raw existing roster names are preserved exactly in candidates', () => {
    const review = buildScrapedJsonImportRosterAwareReview(
      selectedSession(playerPayload(['Smith,  Jordan'])),
      [existingTeam(['Smith,  Jordan'])]
    );
    const row = rowByName(review, 'Smith,  Jordan');
    expect(row.candidates[0]?.existingPlayerName).toBe('Smith,  Jordan');
  });

  it('14. coach target does not expose player identity review', () => {
    const review = buildScrapedJsonImportRosterAwareReview(
      selectedSession(coachPayload()),
      TEAMS
    );
    expect(review.available).toBe(false);
    if (!review.available) expect(review.reason).toBe('coach-target-not-projectable');
  });

  it('15. missing existing roster context produces a deterministic unavailable state', () => {
    const session = selectedSession(playerPayload(['Jordan Smith']));
    const a = buildScrapedJsonImportRosterAwareReview(session, []);
    const b = buildScrapedJsonImportRosterAwareReview(session, []);
    expect(a).toEqual(b);
    expect(a.available).toBe(false);
    if (!a.available) expect(a.reason).toBe('missing-existing-roster-context');
  });

  it('is deterministic across repeated calls with decisions', () => {
    const session = selectedSession(playerPayload(['Jordan Smith', 'Brand New']));
    const review0 = buildScrapedJsonImportRosterAwareReview(session, TEAMS);
    const rowId = rowByName(review0, 'Jordan Smith').sourceRowId!;
    const decisions: ScrapedImportReviewDecisionMap = { [rowId]: 'confirm-match' };
    expect(buildScrapedJsonImportRosterAwareReview(session, TEAMS, decisions)).toEqual(
      buildScrapedJsonImportRosterAwareReview(session, TEAMS, decisions)
    );
  });

  it('10/11. foreign decision keys (from a prior target/source) are ignored', () => {
    // The component clears its decision map on target/source switch; at the engine
    // level, a decision keyed to a row id that is not in this selection has no effect.
    const session = selectedSession(playerPayload(['Jordan Smith']));
    const review = buildScrapedJsonImportRosterAwareReview(session, TEAMS, {
      'scraped:stale:from:another:target': 'confirm-match',
    });
    // The real row stays in its derived unresolved state; the stale key is inert.
    expect(rowByName(review, 'Jordan Smith').outcome).toBe('blocked-unresolved');
    expect(rowByName(review, 'Jordan Smith').decision).toBeNull();
  });

  it('does not mutate the existing team or its players', () => {
    const teams = [existingTeam(['Jordan Smith', 'Jamie Park'])];
    const before = JSON.stringify(teams);
    const session = selectedSession(playerPayload(['Jordan Smith']));
    buildScrapedJsonImportRosterAwareReview(session, teams, {});
    expect(JSON.stringify(teams)).toBe(before);
  });
});
