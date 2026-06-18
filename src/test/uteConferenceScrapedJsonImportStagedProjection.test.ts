import { describe, it, expect } from 'vitest';
import type { Team } from '../domain/types';
import {
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
  getUteScrapedJsonImportSessionSelectableTargets,
} from '../engine/uteConferenceScrapedJsonImportSession';
import {
  buildScrapedJsonImportRosterAwareReview,
  findExistingRosterTeamForContext,
  type ScrapedImportReviewDecisionMap,
} from '../engine/uteConferenceScrapedJsonImportRosterAwareReview';
import { buildScrapedJsonImportStagedProjection } from '../engine/uteConferenceScrapedJsonImportStagedProjection';

// ---------------------------------------------------------------------------
// Helpers: a 2026 alta GR B1 player source + a controllable existing team.
// ---------------------------------------------------------------------------

function playerPayload(playerNames: string[], recordType = 'players') {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: '2026 Fall Season',
      age_division: 'GR League 9',
      age_division_alias: 'GR',
      year: 2026,
      record_type: recordType,
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

/** Builds review + locates the team the same way the view model does. */
function reviewAndTeam(
  payload: unknown,
  teams: Team[],
  decisions: ScrapedImportReviewDecisionMap = {}
) {
  const session = selectedSession(payload);
  const review = buildScrapedJsonImportRosterAwareReview(session, teams, decisions);
  const ctx = session.selectedCanonicalContextMapping!.canonicalContext;
  const team = findExistingRosterTeamForContext(teams, {
    seasonId: ctx.seasonId,
    districtId: ctx.districtId,
    ageDivisionId: ctx.ageDivisionId,
    teamClassification: ctx.teamClassification,
  });
  return { session, review, team };
}

/** The decision map id for an imported row by its imported name. */
function rowIdByName(
  review: ReturnType<typeof buildScrapedJsonImportRosterAwareReview>,
  name: string
) {
  if (!review.available) throw new Error('review unavailable');
  return review.rows.find((r) => r.playerName === name)!.sourceRowId!;
}

const TEAM = [existingTeam(['Jordan Smith', 'Taylor Johnson'])];
const TEAM_DUP = [existingTeam(['Jamie Park', 'Jamie Park', 'Jordan Smith'])];

describe('staged import projection', () => {
  it('1+5. a clean dry run stages a projected roster; likely-new appears as projected new', () => {
    const { review, team } = reviewAndTeam(playerPayload(['Brand New']), TEAM);
    const staged = buildScrapedJsonImportStagedProjection(review, team);
    expect(staged.stageable).toBe(true);
    if (staged.stageable) {
      expect(staged.actualRosterCount).toBe(2);
      expect(staged.stagedNewCount).toBe(1);
      expect(staged.projectedRosterCount).toBe(3);
      expect(staged.projectedNewPlayers.map((p) => p.name)).toEqual(['Brand New']);
    }
  });

  it('2. unresolved ambiguity prevents staging', () => {
    // Jamie Park matches a duplicate existing name -> ambiguous, unresolved by default.
    const { review, team } = reviewAndTeam(playerPayload(['Jamie Park']), TEAM_DUP);
    const staged = buildScrapedJsonImportStagedProjection(review, team);
    expect(staged.stageable).toBe(false);
    if (!staged.stageable) expect(staged.reason).toBe('dry-run-not-clean');
  });

  it('3. an unresolved match-bearing (blocked) row prevents staging', () => {
    // Jordan Smith matches one existing record -> likely-existing, unresolved by default.
    const { review, team } = reviewAndTeam(playerPayload(['Jordan Smith']), TEAM);
    const staged = buildScrapedJsonImportStagedProjection(review, team);
    expect(staged.stageable).toBe(false);
    if (!staged.stageable) expect(staged.reason).toBe('dry-run-not-clean');
  });

  it('4. missing existing roster context prevents staging', () => {
    const { review, team } = reviewAndTeam(playerPayload(['Brand New']), []);
    expect(review.available).toBe(false);
    const staged = buildScrapedJsonImportStagedProjection(review, team);
    expect(staged.stageable).toBe(false);
    if (!staged.stageable) expect(staged.reason).toBe('review-unavailable');
  });

  it('6. a confirmed match appears as a projected linked existing player', () => {
    const { review: r0, team } = reviewAndTeam(playerPayload(['Jordan Smith']), TEAM);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'confirm-match',
    };
    const { review } = reviewAndTeam(playerPayload(['Jordan Smith']), TEAM, decisions);
    const staged = buildScrapedJsonImportStagedProjection(review, team);
    expect(staged.stageable).toBe(true);
    if (staged.stageable) {
      expect(staged.stagedLinkCount).toBe(1);
      expect(staged.stagedNewCount).toBe(0);
      expect(staged.projectedRosterCount).toBe(2); // links do not grow the roster
      const linked = staged.existingPlayers.find((p) => p.linked);
      expect(linked?.name).toBe('Jordan Smith');
      expect(linked?.linkedFromImportedName).toBe('Jordan Smith');
    }
  });

  it('7. create-new on an ambiguous row appears as a projected new player', () => {
    const { review: r0, team } = reviewAndTeam(playerPayload(['Jamie Park']), TEAM_DUP);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jamie Park')]: 'create-new',
    };
    const { review } = reviewAndTeam(playerPayload(['Jamie Park']), TEAM_DUP, decisions);
    const staged = buildScrapedJsonImportStagedProjection(review, team);
    expect(staged.stageable).toBe(true);
    if (staged.stageable) {
      expect(staged.projectedNewPlayers.map((p) => p.name)).toEqual(['Jamie Park']);
    }
  });

  it('8. needs-review (defer) decision still stages, listing the row as deferred (not added)', () => {
    const { review: r0, team } = reviewAndTeam(playerPayload(['Jordan Smith', 'Brand New']), TEAM);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'needs-review',
    };
    const { review } = reviewAndTeam(
      playerPayload(['Jordan Smith', 'Brand New']),
      TEAM,
      decisions
    );
    const staged = buildScrapedJsonImportStagedProjection(review, team);
    expect(staged.stageable).toBe(true);
    if (staged.stageable) {
      expect(staged.deferredCount).toBe(1);
      expect(staged.deferredRows.map((r) => r.name)).toEqual(['Jordan Smith']);
      // deferred is not added; only Brand New (new) grows the roster
      expect(staged.projectedRosterCount).toBe(3);
      expect(staged.stagedNewCount).toBe(1);
    }
  });

  it('9+10. projected roster count is deterministic and imported source order preserved', () => {
    const decisionsFor = (review: ReturnType<typeof buildScrapedJsonImportRosterAwareReview>) => ({
      [rowIdByName(review, 'Jordan Smith')]: 'confirm-match' as const,
    });
    const { review: r0 } = reviewAndTeam(
      playerPayload(['Anna New', 'Jordan Smith', 'Zed New']),
      TEAM
    );
    const built = reviewAndTeam(
      playerPayload(['Anna New', 'Jordan Smith', 'Zed New']),
      TEAM,
      decisionsFor(r0)
    );
    const a = buildScrapedJsonImportStagedProjection(built.review, built.team);
    const b = buildScrapedJsonImportStagedProjection(built.review, built.team);
    expect(a).toEqual(b);
    if (a.stageable) {
      expect(a.projectedNewPlayers.map((p) => p.name)).toEqual(['Anna New', 'Zed New']);
      expect(a.projectedRosterCount).toBe(4); // 2 existing + 2 new (Jordan linked)
    }
  });

  it('11+12. raw imported and existing names are preserved exactly', () => {
    const { review: r0, team } = reviewAndTeam(
      playerPayload(['Cary, Hudson', 'Smith,  Jordan']),
      [existingTeam(['Smith,  Jordan'])]
    );
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Smith,  Jordan')]: 'confirm-match',
    };
    const { review } = reviewAndTeam(
      playerPayload(['Cary, Hudson', 'Smith,  Jordan']),
      [existingTeam(['Smith,  Jordan'])],
      decisions
    );
    const staged = buildScrapedJsonImportStagedProjection(review, team);
    if (!staged.stageable) throw new Error('expected stageable');
    expect(staged.projectedNewPlayers.map((p) => p.name)).toEqual(['Cary, Hudson']);
    expect(staged.existingPlayers.map((p) => p.name)).toEqual(['Smith,  Jordan']);
  });

  it('13+14. existing team and review are not mutated by staging', () => {
    const teams = [existingTeam(['Jordan Smith', 'Taylor Johnson'])];
    const before = JSON.stringify(teams);
    const { review, team } = reviewAndTeam(playerPayload(['Brand New']), teams);
    const reviewBefore = JSON.stringify(review);
    buildScrapedJsonImportStagedProjection(review, team);
    expect(JSON.stringify(teams)).toBe(before);
    expect(JSON.stringify(review)).toBe(reviewBefore);
  });

  it('16. coach target does not expose player staging', () => {
    const { review, team } = reviewAndTeam(playerPayload(['Coach One'], 'coaches'), TEAM);
    const staged = buildScrapedJsonImportStagedProjection(review, team);
    expect(staged.stageable).toBe(false);
    if (!staged.stageable) expect(staged.reason).toBe('review-unavailable');
  });
});
