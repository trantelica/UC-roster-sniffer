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
  type ScrapedImportRosterAwareReview,
} from '../engine/uteConferenceScrapedJsonImportRosterAwareReview';
import { buildScrapedJsonImportStagedProjection } from '../engine/uteConferenceScrapedJsonImportStagedProjection';
import { buildScrapedJsonImportFutureCommitReadiness } from '../engine/uteConferenceScrapedJsonImportFutureReadiness';

// ---------------------------------------------------------------------------
// Helpers: mirror the staged-projection test harness (2026 alta GR B1).
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

function rowIdByName(review: ScrapedImportRosterAwareReview, name: string) {
  if (!review.available) throw new Error('review unavailable');
  return review.rows.find((r) => r.playerName === name)!.sourceRowId!;
}

/** Builds the gate the same way the view model does. */
function readinessFor(
  payload: unknown,
  teams: Team[],
  decisions: ScrapedImportReviewDecisionMap = {}
) {
  const { review, team } = reviewAndTeam(payload, teams, decisions);
  const staged = buildScrapedJsonImportStagedProjection(review, team);
  return buildScrapedJsonImportFutureCommitReadiness(review, staged);
}

const TEAM = [existingTeam(['Jordan Smith', 'Taylor Johnson'])];
const TEAM_DUP = [existingTeam(['Jamie Park', 'Jamie Park', 'Jordan Smith'])];

describe('future import commit readiness', () => {
  it('all rows ready/addable -> ready for future commit, counted as additions', () => {
    const readiness = readinessFor(playerPayload(['Brand New', 'Other New']), TEAM);
    expect(readiness.available).toBe(true);
    expect(readiness.isReadyForFutureCommit).toBe(true);
    expect(readiness.readyAdditions).toBe(2);
    expect(readiness.readyLinks).toBe(0);
    expect(readiness.deferredRows).toBe(0);
    expect(readiness.unresolvedRows).toBe(0);
    expect(readiness.blockedRows).toBe(0);
    expect(readiness.totalIncomingRows).toBe(2);
    expect(readiness.totalProjectedRosterRows).toBe(4); // 2 existing + 2 new
    expect(readiness.blockingReasons).toHaveLength(0);
  });

  it('confirmed match is counted as a link, not a new addition', () => {
    const { review: r0 } = reviewAndTeam(playerPayload(['Jordan Smith']), TEAM);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'confirm-match',
    };
    const readiness = readinessFor(playerPayload(['Jordan Smith']), TEAM, decisions);
    expect(readiness.isReadyForFutureCommit).toBe(true);
    expect(readiness.readyLinks).toBe(1);
    expect(readiness.readyAdditions).toBe(0);
    expect(readiness.totalProjectedRosterRows).toBe(2); // links do not grow the roster
  });

  it('deferred rows are counted as deferred, not additions, and still ready', () => {
    const { review: r0 } = reviewAndTeam(
      playerPayload(['Jordan Smith', 'Brand New']),
      TEAM
    );
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'needs-review',
    };
    const readiness = readinessFor(
      playerPayload(['Jordan Smith', 'Brand New']),
      TEAM,
      decisions
    );
    expect(readiness.isReadyForFutureCommit).toBe(true);
    expect(readiness.deferredRows).toBe(1);
    expect(readiness.readyAdditions).toBe(1);
    expect(readiness.totalProjectedRosterRows).toBe(3); // deferred not added
  });

  it('an unresolved match-bearing row blocks future commit', () => {
    // Jordan Smith matches an existing record but has no decision -> unresolved.
    const readiness = readinessFor(playerPayload(['Jordan Smith']), TEAM);
    expect(readiness.isReadyForFutureCommit).toBe(false);
    expect(readiness.unresolvedRows).toBe(1);
    expect(readiness.totalProjectedRosterRows).toBeNull();
    expect(readiness.blockingReasons.map((r) => r.code)).toContain(
      'unresolved-rows-remain'
    );
    // The staged-projection blocker is NOT double-reported (unresolved already explains it).
    expect(readiness.blockingReasons.map((r) => r.code)).not.toContain(
      'staged-projection-unavailable'
    );
  });

  it('unresolved ambiguity blocks future commit', () => {
    const readiness = readinessFor(playerPayload(['Jamie Park']), TEAM_DUP);
    expect(readiness.isReadyForFutureCommit).toBe(false);
    expect(readiness.unresolvedRows).toBe(1);
    expect(readiness.blockingReasons.map((r) => r.code)).toContain(
      'unresolved-rows-remain'
    );
  });

  it('mixed add / link / defer / unresolved: unresolved still blocks, counts are exact', () => {
    const team = [existingTeam(['Jordan Smith', 'Taylor Johnson'])];
    const names = ['Brand New', 'Jordan Smith', 'Taylor Johnson'];
    const { review: r0 } = reviewAndTeam(playerPayload(names), team);
    // Link Jordan, defer Taylor, leave Brand New as a default create. Nothing unresolved
    // here -> ready. Then drop the Taylor decision to introduce an unresolved row.
    const decisionsClean: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'confirm-match',
      [rowIdByName(r0, 'Taylor Johnson')]: 'needs-review',
    };
    const clean = readinessFor(playerPayload(names), team, decisionsClean);
    expect(clean.isReadyForFutureCommit).toBe(true);
    expect(clean.readyAdditions).toBe(1);
    expect(clean.readyLinks).toBe(1);
    expect(clean.deferredRows).toBe(1);
    expect(clean.unresolvedRows).toBe(0);

    const decisionsBlocked: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'confirm-match',
    };
    const blocked = readinessFor(playerPayload(names), team, decisionsBlocked);
    expect(blocked.isReadyForFutureCommit).toBe(false);
    expect(blocked.unresolvedRows).toBe(1); // Taylor Johnson now unresolved
    expect(blocked.readyAdditions).toBe(1);
    expect(blocked.readyLinks).toBe(1);
  });

  it('unavailable review (no existing roster) is not ready and explains why', () => {
    const readiness = readinessFor(playerPayload(['Brand New']), []);
    expect(readiness.available).toBe(false);
    expect(readiness.isReadyForFutureCommit).toBe(false);
    expect(readiness.totalIncomingRows).toBe(0);
    expect(readiness.totalProjectedRosterRows).toBeNull();
    expect(readiness.blockingReasons.map((r) => r.code)).toEqual([
      'review-unavailable',
    ]);
  });

  it('blocked rows (hand-built review) prevent future commit', () => {
    // A hand-built available review with one structurally blocked row, no staged
    // projection. Exercises the gate's blocked-row path directly.
    const review: ScrapedImportRosterAwareReview = {
      available: true,
      existingTeamId: '2026-alta-GR-B1',
      existingPlayerCount: 1,
      rows: [
        {
          sourceRowId: 'row-0',
          rowIndex: 0,
          playerName: null,
          matchStatus: 'blocked',
          candidates: [],
          confirmable: false,
          decision: null,
          outcome: 'blocked',
          planStatus: 'rejected',
          linkTargetExistingRecordId: null,
          linkTargetExistingName: null,
          projectedNewPlayerName: null,
        },
      ],
      summary: {
        totalRows: 1,
        likelyNew: 0,
        likelyExisting: 0,
        ambiguous: 0,
        needsReview: 0,
        blocked: 1,
        projectedCreateRows: 0,
        projectedLinkRows: 0,
        deferredRows: 0,
        unresolvedRows: 0,
        canCommit: false,
      },
    };
    const readiness = buildScrapedJsonImportFutureCommitReadiness(review, {
      stageable: false,
      reason: 'dry-run-not-clean',
      message: 'not clean',
    });
    expect(readiness.isReadyForFutureCommit).toBe(false);
    expect(readiness.blockedRows).toBe(1);
    expect(readiness.blockingReasons.map((r) => r.code)).toContain(
      'blocked-rows-present'
    );
  });

  it('is deterministic across repeated calls', () => {
    const a = readinessFor(playerPayload(['Brand New']), TEAM);
    const b = readinessFor(playerPayload(['Brand New']), TEAM);
    expect(a).toEqual(b);
  });
});
