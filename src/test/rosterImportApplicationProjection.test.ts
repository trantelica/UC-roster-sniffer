import { describe, it, expect } from 'vitest';
import {
  createRosterImportApplicationProjection,
  summarizeRosterImportApplicationProjection,
  getRosterImportApplicationProjectionLinkedRows,
  getRosterImportApplicationProjectionNewRows,
  getRosterImportApplicationProjectionSkippedRows,
  ROSTER_IMPORT_APPLICATION_PROJECTION_LOGIC_VERSION,
} from '../engine/rosterImportApplicationProjection';
import type { ExistingRosterProjectionRecord } from '../engine/rosterImportApplicationProjection';
import {
  createRosterImportCommitPreviewPlan,
  summarizeRosterImportCommitPreviewPlanRows,
} from '../engine/rosterImportCommitPreviewPlan';
import type {
  RosterImportCommitPreviewPlanResult,
  RosterImportCommitPreviewPlanRow,
} from '../engine/rosterImportCommitPreviewPlan';
import type {
  AppliedRosterImportIdentityReviewDecisionEntry,
  RosterImportIdentityReviewEffectiveOutcome,
} from '../engine/rosterImportIdentityReviewDecisionApplication';
import type { RosterImportPreviewIdentityMatchEntry } from '../engine/rosterImportPreviewIdentityMatch';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TARGET = {
  seasonId: '2026',
  districtId: 'alta',
  ageDivisionId: 'GI',
  teamId: '2026-alta-GI-A1',
};

function originalEntry(): RosterImportPreviewIdentityMatchEntry {
  return {
    previewSourceRowId: 'r1',
    previewRowIndex: 0,
    previewPlayerName: 'Jordan Smith',
    previewNormalizedIdentityKey: 'jordan smith',
    status: 'single-candidate',
    candidates: [],
    issues: [],
  };
}

/** Build a slice 5 applied entry for a given effective outcome. */
function applied(
  effectiveOutcome: RosterImportIdentityReviewEffectiveOutcome,
  overrides: Partial<AppliedRosterImportIdentityReviewDecisionEntry> = {}
): AppliedRosterImportIdentityReviewDecisionEntry {
  return {
    previewSourceRowId: 'r1',
    previewRowIndex: 0,
    previewPlayerName: 'Jordan Smith',
    sourceEntryStatus: 'single-candidate',
    effectiveOutcome,
    effectiveConfidence: 'high',
    appliedDecisionId: null,
    selectedExistingRecordId: null,
    manualExistingRecordId: null,
    reasons: ['no-decision-unresolved'],
    issues: [],
    originalEntry: originalEntry(),
    ...overrides,
  };
}

function existing(
  recordId: string,
  overrides: Partial<ExistingRosterProjectionRecord> = {}
): ExistingRosterProjectionRecord {
  return {
    recordId,
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId: 'GI',
    teamId: '2026-alta-GI-A1',
    playerName: 'Jordan Smith',
    ...overrides,
  };
}

/** A hand-crafted plan row (for defensive cases the slice 6 builder cannot make). */
function planRow(
  overrides: Partial<RosterImportCommitPreviewPlanRow> = {}
): RosterImportCommitPreviewPlanRow {
  return {
    previewSourceRowId: 'r1',
    previewRowIndex: 0,
    previewPlayerName: 'Jordan Smith',
    sourceEntryStatus: 'single-candidate',
    effectiveOutcome: 'link-to-existing',
    planStatus: 'ready-to-link',
    plannedOperation: 'link-existing-record',
    targetExistingRecordId: 'e1',
    reasons: ['accepted-candidate-link'],
    blockers: [],
    originalAppliedEntry: applied('link-to-existing', {
      selectedExistingRecordId: 'e1',
    }),
    ...overrides,
  };
}

/** A hand-crafted committable plan result wrapping the given rows. */
function planResult(
  rows: RosterImportCommitPreviewPlanRow[],
  overrides: Partial<RosterImportCommitPreviewPlanResult> = {}
): RosterImportCommitPreviewPlanResult {
  return {
    canCommit: true,
    targetContext: { ...TARGET },
    targetContextProvided: true,
    targetContextValid: true,
    rows,
    blockers: [],
    summary: summarizeRosterImportCommitPreviewPlanRows(rows),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. empty committable plan
// ---------------------------------------------------------------------------

describe('createRosterImportApplicationProjection - empty', () => {
  it('1. an empty committable plan returns a deterministic projection result', () => {
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('rejected')],
      targetContext: TARGET,
    });
    // Remove the row to get an empty-but-committable shape via direct construction.
    const emptyPlan = planResult([], { canCommit: true });
    const result = createRosterImportApplicationProjection({ plan: emptyPlan });
    expect(result.rows).toEqual([]);
    // An empty committable plan has no rows -> nothing to project. ok stays false
    // (no produced rows) at result level, mirroring slice 6's empty-plan handling.
    expect(result.planCommittable).toBe(true);
    expect(result.summary.totalRows).toBe(0);
    expect(result.blockers).toEqual([]);
    // Determinism: a second call is identical.
    const again = createRosterImportApplicationProjection({ plan: emptyPlan });
    expect(again).toEqual(result);
    void plan;
  });
});

// ---------------------------------------------------------------------------
// 2. non-committable plan
// ---------------------------------------------------------------------------

describe('non-committable plan', () => {
  it('2. returns ok=false with a plan-not-committable blocker and no rows', () => {
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('unresolved')],
      targetContext: TARGET,
    });
    expect(plan.canCommit).toBe(false);
    const result = createRosterImportApplicationProjection({ plan });
    expect(result.ok).toBe(false);
    expect(result.planCommittable).toBe(false);
    expect(result.blockers).toEqual(['plan-not-committable']);
    expect(result.rows).toEqual([]);
    expect(result.summary.blockerCount).toBe(1);
    expect(result.summary.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3-6. ready-to-link
// ---------------------------------------------------------------------------

describe('ready-to-link projection', () => {
  it('3. projects a link when exactly one existing record matches the target id', () => {
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('link-to-existing', { selectedExistingRecordId: 'e1' }),
      ],
      targetContext: TARGET,
    });
    expect(plan.canCommit).toBe(true);
    const result = createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: [existing('e1')],
    });
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row.projectionStatus).toBe('projected-link');
    expect(row.projectedOperation).toBe('link-existing-record');
    expect(row.targetExistingRecordId).toBe('e1');
    expect(row.reasons).toEqual(['linked-to-existing-record']);
    expect(row.blockers).toEqual([]);
    expect(row.projectedNewRecord).toBeUndefined();
  });

  it('4. blocks when the target existing record id is missing on the plan row', () => {
    const plan = planResult([
      planRow({ targetExistingRecordId: null }),
    ]);
    const result = createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: [existing('e1')],
    });
    expect(result.ok).toBe(false);
    expect(result.rows[0].projectionStatus).toBe('blocked');
    expect(result.rows[0].blockers).toEqual(['invalid-plan-row']);
  });

  it('5. blocks when no existing record matches the target id', () => {
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('link-to-existing', { selectedExistingRecordId: 'e1' }),
      ],
      targetContext: TARGET,
    });
    const result = createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: [existing('other')],
    });
    expect(result.ok).toBe(false);
    expect(result.rows[0].projectionStatus).toBe('blocked');
    expect(result.rows[0].blockers).toEqual(['missing-existing-record']);
    expect(result.rows[0].targetExistingRecordId).toBe('e1');
  });

  it('6. blocks when duplicate existing record ids exist for the target', () => {
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('link-to-existing', { selectedExistingRecordId: 'e1' }),
      ],
      targetContext: TARGET,
    });
    const result = createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: [
        existing('e1'),
        existing('e1', { playerName: 'Jordan Smith (dup)' }),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.rows[0].projectionStatus).toBe('blocked');
    expect(result.rows[0].blockers).toEqual(['duplicate-existing-record-id']);
  });
});

// ---------------------------------------------------------------------------
// 7-9. ready-to-create
// ---------------------------------------------------------------------------

describe('ready-to-create projection', () => {
  it('7. projects a provisional new roster record', () => {
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('create-new')],
      targetContext: TARGET,
    });
    expect(plan.canCommit).toBe(true);
    const result = createRosterImportApplicationProjection({ plan });
    expect(result.ok).toBe(true);
    const row = result.rows[0];
    expect(row.projectionStatus).toBe('projected-create');
    expect(row.projectedOperation).toBe('create-new-roster-entry');
    expect(row.reasons).toEqual(['projected-new-roster-entry']);
    expect(row.blockers).toEqual([]);
    const rec = row.projectedNewRecord;
    expect(rec).toBeDefined();
    expect(rec?.seasonId).toBe('2026');
    expect(rec?.districtId).toBe('alta');
    expect(rec?.ageDivisionId).toBe('GI');
    expect(rec?.teamId).toBe('2026-alta-GI-A1');
    expect(rec?.playerName).toBe('Jordan Smith');
    expect(rec?.sourceRowId).toBe('r1');
    expect(rec?.sourceRowIndex).toBe(0);
    expect(rec?.provisionalRecordId).toBe(
      'projected:2026:alta:GI:2026-alta-GI-A1:r1:0'
    );
    expect(rec?.source.provisional).toBe(true);
    expect(rec?.source.logicVersion).toBe(
      ROSTER_IMPORT_APPLICATION_PROJECTION_LOGIC_VERSION
    );
  });

  it('8. blocks when target context is missing', () => {
    // No target context provided to slice 6 -> committable with null context.
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('create-new')],
    });
    expect(plan.canCommit).toBe(true);
    expect(plan.targetContext.seasonId).toBeNull();
    const result = createRosterImportApplicationProjection({ plan });
    expect(result.ok).toBe(false);
    expect(result.rows[0].projectionStatus).toBe('blocked');
    expect(result.rows[0].blockers).toEqual(['missing-target-context']);
    expect(result.rows[0].projectedNewRecord).toBeUndefined();
  });

  it('9. blocks when the player name is missing', () => {
    const plan = planResult([
      planRow({
        planStatus: 'ready-to-create',
        plannedOperation: 'create-new-roster-entry',
        effectiveOutcome: 'create-new',
        previewPlayerName: null,
        targetExistingRecordId: null,
      }),
    ]);
    const result = createRosterImportApplicationProjection({ plan });
    expect(result.ok).toBe(false);
    expect(result.rows[0].projectionStatus).toBe('blocked');
    expect(result.rows[0].blockers).toEqual(['missing-player-name-for-create']);
  });
});

// ---------------------------------------------------------------------------
// 10-11. rejected / deferred preservation
// ---------------------------------------------------------------------------

describe('rejected / deferred projection', () => {
  it('10. projects reject and preserves the row', () => {
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('rejected')],
      targetContext: TARGET,
    });
    const result = createRosterImportApplicationProjection({ plan });
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].projectionStatus).toBe('projected-reject');
    expect(result.rows[0].projectedOperation).toBe('reject-import-row');
    expect(result.rows[0].reasons).toEqual(['reviewer-rejected']);
  });

  it('11. projects defer and preserves the row', () => {
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('deferred')],
      targetContext: TARGET,
    });
    const result = createRosterImportApplicationProjection({ plan });
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].projectionStatus).toBe('projected-defer');
    expect(result.rows[0].projectedOperation).toBe('defer-review');
    expect(result.rows[0].reasons).toEqual(['reviewer-deferred']);
  });

  it('projects reject/defer as skipped when options disable them', () => {
    const plan = planResult([
      planRow({
        planStatus: 'rejected',
        plannedOperation: 'reject-import-row',
        effectiveOutcome: 'rejected',
        targetExistingRecordId: null,
      }),
      planRow({
        previewSourceRowId: 'r2',
        previewRowIndex: 1,
        planStatus: 'deferred',
        plannedOperation: 'defer-review',
        effectiveOutcome: 'deferred',
        targetExistingRecordId: null,
      }),
    ]);
    const result = createRosterImportApplicationProjection({
      plan,
      options: { allowRejectedRows: false, allowDeferredRows: false },
    });
    expect(result.rows[0].projectionStatus).toBe('skipped');
    expect(result.rows[0].reasons).toEqual(['skipped-non-committed-row']);
    expect(result.rows[1].projectionStatus).toBe('skipped');
    expect(result.summary.skippedRows).toBe(2);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. blocked plan row inside an otherwise committable plan
// ---------------------------------------------------------------------------

describe('defensive blocked plan rows', () => {
  it('12. a blocked plan row is blocked and forces ok=false', () => {
    const plan = planResult([
      planRow(),
      planRow({
        previewSourceRowId: 'r2',
        previewRowIndex: 1,
        planStatus: 'blocked-unresolved',
        plannedOperation: 'none',
        effectiveOutcome: 'unresolved',
        targetExistingRecordId: null,
      }),
    ]);
    const result = createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: [existing('e1')],
    });
    expect(result.ok).toBe(false);
    expect(result.rows[1].projectionStatus).toBe('blocked');
    expect(result.rows[1].blockers).toEqual(['blocked-plan-row']);
    // The committable row before it is still projected normally.
    expect(result.rows[0].projectionStatus).toBe('projected-link');
  });
});

// ---------------------------------------------------------------------------
// 13. order preservation
// ---------------------------------------------------------------------------

describe('row order', () => {
  it('13. projected row order follows plan row order', () => {
    const plan = planResult([
      planRow({ previewSourceRowId: 'a', previewRowIndex: 0 }),
      planRow({
        previewSourceRowId: 'b',
        previewRowIndex: 1,
        planStatus: 'ready-to-create',
        plannedOperation: 'create-new-roster-entry',
        effectiveOutcome: 'create-new',
        targetExistingRecordId: null,
      }),
      planRow({
        previewSourceRowId: 'c',
        previewRowIndex: 2,
        planStatus: 'rejected',
        plannedOperation: 'reject-import-row',
        effectiveOutcome: 'rejected',
        targetExistingRecordId: null,
      }),
    ]);
    const result = createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: [existing('e1')],
    });
    expect(result.rows.map((r) => r.previewSourceRowId)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(result.rows.map((r) => r.projectionStatus)).toEqual([
      'projected-link',
      'projected-create',
      'projected-reject',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 14-16. helpers
// ---------------------------------------------------------------------------

describe('filter helpers', () => {
  function mixedResult() {
    const plan = planResult([
      planRow({ previewSourceRowId: 'a', previewRowIndex: 0 }),
      planRow({
        previewSourceRowId: 'b',
        previewRowIndex: 1,
        planStatus: 'ready-to-create',
        plannedOperation: 'create-new-roster-entry',
        effectiveOutcome: 'create-new',
        targetExistingRecordId: null,
      }),
      planRow({
        previewSourceRowId: 'c',
        previewRowIndex: 2,
        planStatus: 'rejected',
        plannedOperation: 'reject-import-row',
        effectiveOutcome: 'rejected',
        targetExistingRecordId: null,
      }),
      planRow({
        previewSourceRowId: 'd',
        previewRowIndex: 3,
        planStatus: 'deferred',
        plannedOperation: 'defer-review',
        effectiveOutcome: 'deferred',
        targetExistingRecordId: null,
      }),
    ]);
    return createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: [existing('e1')],
    });
  }

  it('14. linked helper returns projected-link rows only', () => {
    const result = mixedResult();
    const linked = getRosterImportApplicationProjectionLinkedRows(result);
    expect(linked.map((r) => r.previewSourceRowId)).toEqual(['a']);
    expect(linked.every((r) => r.projectionStatus === 'projected-link')).toBe(
      true
    );
  });

  it('15. new helper returns projected-create rows only', () => {
    const result = mixedResult();
    const created = getRosterImportApplicationProjectionNewRows(result.rows);
    expect(created.map((r) => r.previewSourceRowId)).toEqual(['b']);
    expect(
      created.every((r) => r.projectionStatus === 'projected-create')
    ).toBe(true);
  });

  it('16. skipped helper returns rejected/deferred/skipped rows', () => {
    const result = mixedResult();
    const skipped = getRosterImportApplicationProjectionSkippedRows(result);
    expect(skipped.map((r) => r.previewSourceRowId)).toEqual(['c', 'd']);
  });
});

// ---------------------------------------------------------------------------
// 17. summary
// ---------------------------------------------------------------------------

describe('summary', () => {
  it('17. counts rows, statuses, and blockers accurately', () => {
    const plan = planResult([
      planRow({ previewSourceRowId: 'a', previewRowIndex: 0 }),
      planRow({
        previewSourceRowId: 'b',
        previewRowIndex: 1,
        planStatus: 'ready-to-create',
        plannedOperation: 'create-new-roster-entry',
        effectiveOutcome: 'create-new',
        targetExistingRecordId: null,
      }),
      planRow({
        previewSourceRowId: 'c',
        previewRowIndex: 2,
        planStatus: 'rejected',
        plannedOperation: 'reject-import-row',
        effectiveOutcome: 'rejected',
        targetExistingRecordId: null,
      }),
      planRow({
        previewSourceRowId: 'd',
        previewRowIndex: 3,
        planStatus: 'deferred',
        plannedOperation: 'defer-review',
        effectiveOutcome: 'deferred',
        targetExistingRecordId: null,
      }),
      planRow({
        previewSourceRowId: 'e',
        previewRowIndex: 4,
        targetExistingRecordId: 'missing',
      }),
    ]);
    const result = createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: [existing('e1')],
    });
    expect(result.summary).toEqual({
      totalRows: 5,
      projectedLinkRows: 1,
      projectedCreateRows: 1,
      projectedRejectRows: 1,
      projectedDeferRows: 1,
      blockedRows: 1,
      skippedRows: 0,
      blockerCount: 1,
      ok: false,
    });
    // The standalone summarize helper over rows agrees on row-level counts.
    const rowSummary = summarizeRosterImportApplicationProjection(result.rows);
    expect(rowSummary.totalRows).toBe(5);
    expect(rowSummary.blockedRows).toBe(1);
    expect(rowSummary.blockerCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 18-20. immutability
// ---------------------------------------------------------------------------

describe('immutability', () => {
  it('18-19. does not mutate the input plan or its rows', () => {
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('link-to-existing', { selectedExistingRecordId: 'e1' }),
        applied('create-new', {
          previewSourceRowId: 'r2',
          previewRowIndex: 1,
        }),
      ],
      targetContext: TARGET,
    });
    const before = JSON.parse(JSON.stringify(plan));
    createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: [existing('e1')],
    });
    expect(JSON.parse(JSON.stringify(plan))).toEqual(before);
  });

  it('20. does not mutate the existing roster records', () => {
    const records = [existing('e1'), existing('e2', { playerName: 'Sam Lee' })];
    const before = JSON.parse(JSON.stringify(records));
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('link-to-existing', { selectedExistingRecordId: 'e1' }),
      ],
      targetContext: TARGET,
    });
    createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: records,
    });
    expect(JSON.parse(JSON.stringify(records))).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// 21-22. determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('21. projected creates are deterministic across repeated calls', () => {
    const plan = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('create-new')],
      targetContext: TARGET,
    });
    const a = createRosterImportApplicationProjection({ plan });
    const b = createRosterImportApplicationProjection({ plan });
    expect(a.rows[0].projectedNewRecord).toEqual(
      b.rows[0].projectedNewRecord
    );
  });

  it('22. produces deterministic output across repeated calls', () => {
    const plan = planResult([
      planRow({ previewSourceRowId: 'a', previewRowIndex: 0 }),
      planRow({
        previewSourceRowId: 'b',
        previewRowIndex: 1,
        planStatus: 'ready-to-create',
        plannedOperation: 'create-new-roster-entry',
        effectiveOutcome: 'create-new',
        targetExistingRecordId: null,
      }),
      planRow({
        previewSourceRowId: 'c',
        previewRowIndex: 2,
        planStatus: 'deferred',
        plannedOperation: 'defer-review',
        effectiveOutcome: 'deferred',
        targetExistingRecordId: null,
      }),
    ]);
    const records = [existing('e1')];
    const a = createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: records,
    });
    const b = createRosterImportApplicationProjection({
      plan,
      existingRosterRecords: records,
    });
    expect(a).toEqual(b);
  });
});
