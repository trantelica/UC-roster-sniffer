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
import {
  buildScrapedJsonImportTransactionPlan,
  type BuildScrapedImportTransactionPlanInput,
} from '../engine/uteConferenceScrapedJsonImportTransactionPlan';

// ---------------------------------------------------------------------------
// Harness: a 2026 alta GR B1 player source + a controllable existing team.
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

const SOURCE = {
  name: 'demo.json',
  kind: 'players',
  organization: 'Ute Conference',
  event: '2026 Fall Season',
  year: '2026',
};
const TARGET = {
  teamName: 'Gremlin B1',
  existingTeamId: '2026-alta-GR-B1',
  seasonId: '2026',
  districtId: 'alta',
  ageDivisionId: 'GR',
  teamClassification: 'B1',
};
const IDS = { transactionId: 'txn-fixed-1', generatedAt: '2026-06-19T00:00:00.000Z' };

function build(
  payload: unknown,
  teams: Team[],
  decisions: ScrapedImportReviewDecisionMap = {}
) {
  const loaded = createUteScrapedJsonImportSessionFromPayload(payload);
  const id = getUteScrapedJsonImportSessionSelectableTargets(loaded)[0].sourceTargetId;
  const session = selectUteScrapedJsonImportSessionTarget(loaded, id);
  const review = buildScrapedJsonImportRosterAwareReview(session, teams, decisions);
  const ctx = session.selectedCanonicalContextMapping!.canonicalContext;
  const team = findExistingRosterTeamForContext(teams, {
    seasonId: ctx.seasonId,
    districtId: ctx.districtId,
    ageDivisionId: ctx.ageDivisionId,
    teamClassification: ctx.teamClassification,
  });
  const stagedProjection = buildScrapedJsonImportStagedProjection(review, team);
  const readiness = buildScrapedJsonImportFutureCommitReadiness(review, stagedProjection);
  return { review, stagedProjection, readiness };
}

function planFor(
  payload: unknown,
  teams: Team[],
  decisions: ScrapedImportReviewDecisionMap = {},
  overrides: Partial<BuildScrapedImportTransactionPlanInput> = {}
) {
  const { review, stagedProjection, readiness } = build(payload, teams, decisions);
  return buildScrapedJsonImportTransactionPlan({
    ...IDS,
    source: SOURCE,
    target: TARGET,
    review,
    stagedProjection,
    readiness,
    ...overrides,
  });
}

function rowIdByName(review: ScrapedImportRosterAwareReview, name: string) {
  if (!review.available) throw new Error('review unavailable');
  return review.rows.find((r) => r.playerName === name)!.sourceRowId!;
}

const TEAM = [existingTeam(['Jordan Smith', 'Taylor Johnson'])];

describe('import transaction plan', () => {
  it('rejects planning when readiness is not ready and preserves blocking reasons', () => {
    // Jordan Smith matches an existing record but has no decision -> unresolved.
    const plan = planFor(playerPayload(['Jordan Smith']), TEAM);
    expect(plan.status).toBe('rejected');
    if (plan.status === 'rejected') {
      expect(plan.reason).toBe('not-ready');
      expect(plan.executed).toBe(false);
      expect(plan.previewOnly).toBe(true);
      expect(plan.blockingReasons.map((r) => r.code)).toContain('unresolved-rows-remain');
      // The unresolved row is surfaced for inspection; no add ops exist on a rejection.
      expect(plan.rejectedRows.map((r) => r.importedName)).toEqual(['Jordan Smith']);
      expect(plan.rejectedRows[0].reasonCode).toBe('unresolved');
      expect((plan as { addOperations?: unknown }).addOperations).toBeUndefined();
    }
  });

  it('produces add operations for addable rows when ready', () => {
    const plan = planFor(playerPayload(['Brand New', 'Other New']), TEAM);
    expect(plan.status).toBe('planned');
    if (plan.status === 'planned') {
      expect(plan.executed).toBe(false);
      expect(plan.previewOnly).toBe(true);
      expect(plan.addOperations.map((o) => o.projectedRecordName)).toEqual([
        'Brand New',
        'Other New',
      ]);
      expect(plan.addOperations[0].projectedRecordRef).toBe(
        '2026-alta-GR-B1#projected-new#0'
      );
      expect(plan.linkOperations).toHaveLength(0);
      expect(plan.rejectedRows).toHaveLength(0);
      expect(plan.rosterDeltaSummary.addedCount).toBe(2);
      expect(plan.rosterDeltaSummary.netRosterRecordChange).toBe(2);
      expect(plan.beforeRosterSummary.playerCount).toBe(2);
      expect(plan.afterRosterSummary.playerCount).toBe(4);
    }
  });

  it('linked rows produce link/no-op operations and are not counted as additions', () => {
    const { review: r0 } = build(playerPayload(['Jordan Smith']), TEAM);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'confirm-match',
    };
    const plan = planFor(playerPayload(['Jordan Smith']), TEAM, decisions);
    expect(plan.status).toBe('planned');
    if (plan.status === 'planned') {
      expect(plan.addOperations).toHaveLength(0);
      expect(plan.linkOperations).toHaveLength(1);
      expect(plan.linkOperations[0].linkTargetExistingName).toBe('Jordan Smith');
      expect(plan.linkOperations[0].rosterMutation).toBe('none');
      expect(plan.rosterDeltaSummary.linkedNoopCount).toBe(1);
      expect(plan.rosterDeltaSummary.netRosterRecordChange).toBe(0);
      expect(plan.afterRosterSummary.playerCount).toBe(2); // links don't grow the roster
    }
  });

  it('deferred rows are excluded from additions and represented as deferred', () => {
    const { review: r0 } = build(playerPayload(['Jordan Smith', 'Brand New']), TEAM);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'needs-review',
    };
    const plan = planFor(playerPayload(['Jordan Smith', 'Brand New']), TEAM, decisions);
    expect(plan.status).toBe('planned');
    if (plan.status === 'planned') {
      expect(plan.deferredRows.map((r) => r.importedName)).toEqual(['Jordan Smith']);
      expect(plan.addOperations.map((o) => o.importedName)).toEqual(['Brand New']);
      expect(plan.rosterDeltaSummary.deferredExcludedCount).toBe(1);
      expect(plan.afterRosterSummary.playerCount).toBe(3); // deferred not added
    }
  });

  it('mixed add/link/deferred scenario produces a correct delta summary', () => {
    const team = [existingTeam(['Jordan Smith', 'Taylor Johnson'])];
    const names = ['Brand New', 'Jordan Smith', 'Taylor Johnson'];
    const { review: r0 } = build(playerPayload(names), team);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'confirm-match',
      [rowIdByName(r0, 'Taylor Johnson')]: 'needs-review',
    };
    const plan = planFor(playerPayload(names), team, decisions);
    expect(plan.status).toBe('planned');
    if (plan.status === 'planned') {
      expect(plan.rosterDeltaSummary).toEqual({
        addedCount: 1,
        linkedNoopCount: 1,
        deferredExcludedCount: 1,
        rejectedExcludedCount: 0,
        netRosterRecordChange: 1,
      });
      expect(plan.beforeRosterSummary.playerCount).toBe(2);
      expect(plan.afterRosterSummary.playerCount).toBe(3);
    }
  });

  it('rollback/undo preview identifies reversible additions and no-op links', () => {
    const { review: r0 } = build(playerPayload(['Brand New', 'Jordan Smith']), TEAM);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'confirm-match',
    };
    const plan = planFor(playerPayload(['Brand New', 'Jordan Smith']), TEAM, decisions);
    expect(plan.status).toBe('planned');
    if (plan.status === 'planned') {
      const rb = plan.rollbackPlan;
      expect(rb.reversible).toBe(true);
      expect(rb.removableAddedCount).toBe(1);
      expect(rb.removableAddedRecordRefs).toEqual(['2026-alta-GR-B1#projected-new#0']);
      expect(rb.noopLinkCount).toBe(1);
      expect(rb.neverAppliedDeferredCount).toBe(0);
      expect(rb.restoresToPlayerCount).toBe(2); // back to the before count
    }
  });

  it('does not mutate its inputs', () => {
    const { review, stagedProjection, readiness } = build(
      playerPayload(['Brand New']),
      TEAM
    );
    const reviewBefore = JSON.stringify(review);
    const stagedBefore = JSON.stringify(stagedProjection);
    const readinessBefore = JSON.stringify(readiness);
    buildScrapedJsonImportTransactionPlan({
      ...IDS,
      source: SOURCE,
      target: TARGET,
      review,
      stagedProjection,
      readiness,
    });
    expect(JSON.stringify(review)).toBe(reviewBefore);
    expect(JSON.stringify(stagedProjection)).toBe(stagedBefore);
    expect(JSON.stringify(readiness)).toBe(readinessBefore);
  });

  it('caller-supplied transactionId and generatedAt produce deterministic output', () => {
    const a = planFor(playerPayload(['Brand New']), TEAM);
    const b = planFor(playerPayload(['Brand New']), TEAM);
    expect(a).toEqual(b);
    expect(a.transactionId).toBe('txn-fixed-1');
    expect(a.generatedAt).toBe('2026-06-19T00:00:00.000Z');
    expect(a.audit.executed).toBe(false);

    const c = planFor(playerPayload(['Brand New']), TEAM, {}, {
      transactionId: 'txn-other',
      generatedAt: '2027-01-01T00:00:00.000Z',
    });
    expect(c.transactionId).toBe('txn-other');
    expect(c.generatedAt).toBe('2027-01-01T00:00:00.000Z');
  });

  it('preserves raw imported and existing names exactly', () => {
    const { review: r0 } = build(
      playerPayload(['Cary, Hudson', 'Smith,  Jordan']),
      [existingTeam(['Smith,  Jordan'])]
    );
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Smith,  Jordan')]: 'confirm-match',
    };
    const plan = planFor(
      playerPayload(['Cary, Hudson', 'Smith,  Jordan']),
      [existingTeam(['Smith,  Jordan'])],
      decisions
    );
    expect(plan.status).toBe('planned');
    if (plan.status === 'planned') {
      expect(plan.addOperations.map((o) => o.projectedRecordName)).toEqual([
        'Cary, Hudson',
      ]);
      expect(plan.linkOperations[0].linkTargetExistingName).toBe('Smith,  Jordan');
    }
  });
});
