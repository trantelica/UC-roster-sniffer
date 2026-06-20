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
import { buildScrapedJsonImportTransactionPlan } from '../engine/uteConferenceScrapedJsonImportTransactionPlan';
import {
  executeUteConferenceScrapedJsonImportTransaction,
  undoUteConferenceScrapedJsonImportExecution,
  evaluateScrapedJsonImportExecutionAvailability,
} from '../engine/uteConferenceScrapedJsonImportExecution';

// ---------------------------------------------------------------------------
// Harness: 2026 alta GR B1 player source + a controllable existing team.
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
const PLAN_IDS = { transactionId: 'txn-1', generatedAt: '2026-06-19T00:00:00.000Z' };
const EXECUTED_AT = '2026-06-19T01:00:00.000Z';
const UNDONE_AT = '2026-06-19T02:00:00.000Z';

function planFor(
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
  const staged = buildScrapedJsonImportStagedProjection(review, team);
  const readiness = buildScrapedJsonImportFutureCommitReadiness(review, staged);
  const transactionPlan = buildScrapedJsonImportTransactionPlan({
    ...PLAN_IDS,
    source: SOURCE,
    target: TARGET,
    review,
    stagedProjection: staged,
    readiness,
  });
  return { review, team, transactionPlan };
}

function rowIdByName(review: ScrapedImportRosterAwareReview, name: string) {
  if (!review.available) throw new Error('review unavailable');
  return review.rows.find((r) => r.playerName === name)!.sourceRowId!;
}

const TEAM = [existingTeam(['Jordan Smith', 'Taylor Johnson'])];

describe('in-memory import execution', () => {
  it('rejects a rejected/not-ready transaction plan and adds nothing', () => {
    // Jordan Smith matches an existing record with no decision -> unresolved -> not ready.
    const { team, transactionPlan } = planFor(playerPayload(['Jordan Smith']), TEAM);
    expect(transactionPlan.status).toBe('rejected');
    const result = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: team,
      executedAt: EXECUTED_AT,
    });
    expect(result.status).toBe('rejected');
    if (result.status === 'rejected') {
      expect(result.reason).toBe('transaction-not-planned');
      expect(result.durable).toBe(false);
      expect(result.persisted).toBe(false);
      expect(result.rejectionReasons.length).toBeGreaterThan(0);
      expect((result as { appliedAdditions?: unknown }).appliedAdditions).toBeUndefined();
    }
  });

  it('executes a ready planned transaction and adds only addOperations', () => {
    const { team, transactionPlan } = planFor(
      playerPayload(['Brand New', 'Other New']),
      TEAM
    );
    expect(transactionPlan.status).toBe('planned');
    const result = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: team,
      executedAt: EXECUTED_AT,
    });
    expect(result.status).toBe('executed');
    if (result.status === 'executed') {
      expect(result.appliedAdditions.map((a) => a.projectedRecordName)).toEqual([
        'Brand New',
        'Other New',
      ]);
      expect(result.executedTeam.players.map((p) => p.name)).toEqual([
        'Jordan Smith',
        'Taylor Johnson',
        'Brand New',
        'Other New',
      ]);
      expect(result.beforeRosterSummary.playerCount).toBe(2);
      expect(result.afterRosterSummary.playerCount).toBe(4);
      expect(result.rosterDeltaSummary.netRosterRecordChange).toBe(2);
      expect(result.audit.executed).toBe(true);
      expect(result.audit.durable).toBe(false);
      expect(result.audit.persisted).toBe(false);
    }
  });

  it('treats linkOperations as no-ops that create no roster records', () => {
    const { review, team } = planFor(playerPayload(['Jordan Smith']), TEAM);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(review, 'Jordan Smith')]: 'confirm-match',
    };
    const { team: team2, transactionPlan } = planFor(
      playerPayload(['Jordan Smith']),
      TEAM,
      decisions
    );
    const result = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: team2 ?? team,
      executedAt: EXECUTED_AT,
    });
    expect(result.status).toBe('executed');
    if (result.status === 'executed') {
      expect(result.appliedAdditions).toHaveLength(0);
      expect(result.noOpLinks).toHaveLength(1);
      expect(result.afterRosterSummary.playerCount).toBe(2); // unchanged
      expect(result.executedTeam.players.map((p) => p.name)).toEqual([
        'Jordan Smith',
        'Taylor Johnson',
      ]);
    }
  });

  it('skips deferred rows (never applied)', () => {
    const { review } = planFor(playerPayload(['Jordan Smith', 'Brand New']), TEAM);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(review, 'Jordan Smith')]: 'needs-review',
    };
    const { team, transactionPlan } = planFor(
      playerPayload(['Jordan Smith', 'Brand New']),
      TEAM,
      decisions
    );
    const result = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: team,
      executedAt: EXECUTED_AT,
    });
    expect(result.status).toBe('executed');
    if (result.status === 'executed') {
      expect(result.skippedDeferredRows.map((r) => r.importedName)).toEqual([
        'Jordan Smith',
      ]);
      expect(result.appliedAdditions.map((a) => a.projectedRecordName)).toEqual([
        'Brand New',
      ]);
      expect(result.afterRosterSummary.playerCount).toBe(3);
    }
  });

  it('rejects when the existing team is missing or mismatched', () => {
    const { transactionPlan } = planFor(playerPayload(['Brand New']), TEAM);
    const missing = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: null,
      executedAt: EXECUTED_AT,
    });
    expect(missing.status).toBe('rejected');
    if (missing.status === 'rejected') expect(missing.reason).toBe('missing-existing-team');

    const mismatch = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: { ...existingTeam(['X']), teamId: 'some-other-team' },
      executedAt: EXECUTED_AT,
    });
    expect(mismatch.status).toBe('rejected');
    if (mismatch.status === 'rejected') expect(mismatch.reason).toBe('team-mismatch');
  });

  it('preserves existing roster records and imported names exactly', () => {
    const team = [existingTeam(['Smith,  Jordan'])];
    const { transactionPlan, team: located } = planFor(
      playerPayload(['Cary, Hudson']),
      team
    );
    const result = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: located,
      executedAt: EXECUTED_AT,
    });
    expect(result.status).toBe('executed');
    if (result.status === 'executed') {
      expect(result.executedTeam.players.map((p) => p.name)).toEqual([
        'Smith,  Jordan',
        'Cary, Hudson',
      ]);
    }
  });

  it('does not mutate the input team or transaction plan', () => {
    const { team, transactionPlan } = planFor(playerPayload(['Brand New']), TEAM);
    const teamBefore = JSON.stringify(team);
    const planBefore = JSON.stringify(transactionPlan);
    executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: team,
      executedAt: EXECUTED_AT,
    });
    expect(JSON.stringify(team)).toBe(teamBefore);
    expect(JSON.stringify(transactionPlan)).toBe(planBefore);
  });

  it('uses caller-supplied executedAt deterministically', () => {
    const { team, transactionPlan } = planFor(playerPayload(['Brand New']), TEAM);
    const a = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: team,
      executedAt: EXECUTED_AT,
    });
    const b = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: team,
      executedAt: EXECUTED_AT,
    });
    expect(a).toEqual(b);
    if (a.status === 'executed') expect(a.executedAt).toBe(EXECUTED_AT);
  });
});

describe('in-memory import undo', () => {
  function execute(
    payload: unknown,
    teams: Team[],
    decisions: ScrapedImportReviewDecisionMap = {}
  ) {
    const { team, transactionPlan } = planFor(payload, teams, decisions);
    return executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: team,
      executedAt: EXECUTED_AT,
    });
  }

  it('removes only records added by execution and restores the pre-execution count', () => {
    const executionResult = execute(playerPayload(['Brand New', 'Other New']), TEAM);
    const undo = undoUteConferenceScrapedJsonImportExecution({
      executionResult,
      undoneAt: UNDONE_AT,
    });
    expect(undo.status).toBe('undone');
    if (undo.status === 'undone') {
      expect(undo.removedAdditionCount).toBe(2);
      expect(undo.beforeUndoRosterSummary.playerCount).toBe(4);
      expect(undo.afterUndoRosterSummary.playerCount).toBe(2);
      expect(undo.restoredTeam.players.map((p) => p.name)).toEqual([
        'Jordan Smith',
        'Taylor Johnson',
      ]);
      expect(undo.undoneAt).toBe(UNDONE_AT);
    }
  });

  it('preserves linked existing records and counts no-op links', () => {
    const { review } = planFor(playerPayload(['Jordan Smith', 'Brand New']), TEAM);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(review, 'Jordan Smith')]: 'confirm-match',
    };
    const executionResult = execute(
      playerPayload(['Jordan Smith', 'Brand New']),
      TEAM,
      decisions
    );
    const undo = undoUteConferenceScrapedJsonImportExecution({
      executionResult,
      undoneAt: UNDONE_AT,
    });
    expect(undo.status).toBe('undone');
    if (undo.status === 'undone') {
      expect(undo.removedAdditionCount).toBe(1); // only Brand New
      expect(undo.noOpLinksPreserved).toBe(1); // Jordan Smith link
      expect(undo.restoredTeam.players.map((p) => p.name)).toEqual([
        'Jordan Smith',
        'Taylor Johnson',
      ]);
    }
  });

  it('rejects non-executed and malformed execution results', () => {
    const rejectedExec = execute(playerPayload(['Jordan Smith']), TEAM); // not ready
    expect(rejectedExec.status).toBe('rejected');
    const undoRejected = undoUteConferenceScrapedJsonImportExecution({
      executionResult: rejectedExec,
      undoneAt: UNDONE_AT,
    });
    expect(undoRejected.status).toBe('rejected');
    if (undoRejected.status === 'rejected') expect(undoRejected.reason).toBe('not-executed');

    const executed = execute(playerPayload(['Brand New']), TEAM);
    if (executed.status !== 'executed') throw new Error('expected executed');
    // Tamper with the executed team so it no longer matches the recorded additions.
    const malformed = {
      ...executed,
      executedTeam: {
        ...executed.executedTeam,
        players: executed.executedTeam.players.slice(0, 1),
      },
    };
    const undoMalformed = undoUteConferenceScrapedJsonImportExecution({
      executionResult: malformed,
      undoneAt: UNDONE_AT,
    });
    expect(undoMalformed.status).toBe('rejected');
    if (undoMalformed.status === 'rejected') {
      expect(undoMalformed.reason).toBe('malformed-execution');
    }
  });

  it('does not mutate the execution result', () => {
    const executionResult = execute(playerPayload(['Brand New']), TEAM);
    const before = JSON.stringify(executionResult);
    undoUteConferenceScrapedJsonImportExecution({
      executionResult,
      undoneAt: UNDONE_AT,
    });
    expect(JSON.stringify(executionResult)).toBe(before);
  });

  it('executes and undoes a mixed add/link/defer scenario correctly', () => {
    const team = [existingTeam(['Jordan Smith', 'Taylor Johnson'])];
    const names = ['Brand New', 'Jordan Smith', 'Taylor Johnson'];
    const { review } = planFor(playerPayload(names), team);
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(review, 'Jordan Smith')]: 'confirm-match',
      [rowIdByName(review, 'Taylor Johnson')]: 'needs-review',
    };
    const executionResult = execute(playerPayload(names), team, decisions);
    expect(executionResult.status).toBe('executed');
    if (executionResult.status === 'executed') {
      expect(executionResult.rosterDeltaSummary).toMatchObject({
        addedCount: 1,
        noOpLinkCount: 1,
        skippedDeferredCount: 1,
        skippedRejectedCount: 0,
        netRosterRecordChange: 1,
      });
      expect(executionResult.executedTeam.players.map((p) => p.name)).toEqual([
        'Jordan Smith',
        'Taylor Johnson',
        'Brand New',
      ]);
    }
    const undo = undoUteConferenceScrapedJsonImportExecution({
      executionResult,
      undoneAt: UNDONE_AT,
    });
    expect(undo.status).toBe('undone');
    if (undo.status === 'undone') {
      expect(undo.restoredTeam.players.map((p) => p.name)).toEqual([
        'Jordan Smith',
        'Taylor Johnson',
      ]);
    }
  });
});

describe('execution availability gate', () => {
  it('is unavailable when readiness is not ready (plan rejected)', () => {
    const { transactionPlan } = planFor(playerPayload(['Jordan Smith']), TEAM);
    const a = evaluateScrapedJsonImportExecutionAvailability({
      transactionPlan,
      staged: true,
      alreadyExecuted: false,
    });
    expect(a.canExecute).toBe(false);
    expect(a.reasonCode).toBe('transaction-not-planned');
  });

  it('is unavailable when not staged', () => {
    const { transactionPlan } = planFor(playerPayload(['Brand New']), TEAM);
    const a = evaluateScrapedJsonImportExecutionAvailability({
      transactionPlan,
      staged: false,
      alreadyExecuted: false,
    });
    expect(a.canExecute).toBe(false);
    expect(a.reasonCode).toBe('not-staged');
  });

  it('is unavailable when already executed', () => {
    const { transactionPlan } = planFor(playerPayload(['Brand New']), TEAM);
    const a = evaluateScrapedJsonImportExecutionAvailability({
      transactionPlan,
      staged: true,
      alreadyExecuted: true,
    });
    expect(a.canExecute).toBe(false);
    expect(a.reasonCode).toBe('already-executed');
  });

  it('is available when staged, planned, and not executed', () => {
    const { transactionPlan } = planFor(playerPayload(['Brand New']), TEAM);
    const a = evaluateScrapedJsonImportExecutionAvailability({
      transactionPlan,
      staged: true,
      alreadyExecuted: false,
    });
    expect(a.canExecute).toBe(true);
    expect(a.reasonCode).toBe('ready');
  });
});
