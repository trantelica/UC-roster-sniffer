import { describe, it, expect } from 'vitest';
import {
  createRosterImportCommitPreviewPlan,
  summarizeRosterImportCommitPreviewPlanRows,
  getRosterImportCommitPreviewPlanRowsReadyForCommit,
  getRosterImportCommitPreviewPlanRowsBlockingCommit,
} from '../engine/rosterImportCommitPreviewPlan';
import type {
  AppliedRosterImportIdentityReviewDecisionEntry,
  RosterImportIdentityReviewEffectiveOutcome,
} from '../engine/rosterImportIdentityReviewDecisionApplication';
import type { RosterImportPreviewIdentityMatchEntry } from '../engine/rosterImportPreviewIdentityMatch';

// ---------------------------------------------------------------------------
// Helpers — build slice 5 applied entries directly.
// ---------------------------------------------------------------------------

function originalEntry(): RosterImportPreviewIdentityMatchEntry {
  return {
    previewSourceRowId: 'r1',
    previewRowIndex: 0,
    previewPlayerName: 'Jordan Smith',
    previewNormalizedIdentityKey: 'jordan smith',
    status: 'single-candidate',
    candidates: [
      {
        previewSourceRowId: 'r1',
        previewRowIndex: 0,
        existingRecordId: 'e1',
        existingPlayerName: 'Jordan Smith',
        matchType: 'exact-identity-key',
        confidence: 'high',
        reasons: ['exact-normalized-name-match'],
      },
    ],
    issues: [],
  };
}

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
    effectiveConfidence:
      effectiveOutcome === 'unresolved' ? 'none' : 'high',
    appliedDecisionId: null,
    selectedExistingRecordId: null,
    manualExistingRecordId: null,
    reasons: ['no-decision-unresolved'],
    issues: [],
    originalEntry: originalEntry(),
    ...overrides,
  };
}

const TARGET = {
  seasonId: '2026',
  districtId: 'alta',
  ageDivisionId: 'GI',
  teamId: '2026-alta-GI-A1',
};

// ---------------------------------------------------------------------------
// 1. empty
// ---------------------------------------------------------------------------

describe('createRosterImportCommitPreviewPlan - empty', () => {
  it('1. returns a deterministic empty plan with canCommit false', () => {
    const result = createRosterImportCommitPreviewPlan({ appliedEntries: [] });
    expect(result.rows).toEqual([]);
    expect(result.canCommit).toBe(false);
    expect(result.summary.totalRows).toBe(0);
    expect(result.summary.canCommit).toBe(false);
  });

  it('treats missing appliedEntries as empty', () => {
    const result = createRosterImportCommitPreviewPlan({});
    expect(result.rows).toEqual([]);
    expect(result.canCommit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2-3. unresolved
// ---------------------------------------------------------------------------

describe('unresolved outcomes', () => {
  it('2. unresolved entries become blocked-unresolved', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('unresolved')],
    });
    expect(result.rows[0].planStatus).toBe('blocked-unresolved');
    expect(result.rows[0].plannedOperation).toBe('none');
    expect(result.rows[0].blockers).toEqual(['unresolved-identity']);
    expect(result.canCommit).toBe(false);
  });

  it('3. a high-confidence single-candidate unresolved entry is not auto-linked', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('unresolved', {
          sourceEntryStatus: 'single-candidate',
          effectiveConfidence: 'none',
        }),
      ],
    });
    expect(result.rows[0].planStatus).toBe('blocked-unresolved');
    expect(result.rows[0].plannedOperation).toBe('none');
    expect(result.rows[0].targetExistingRecordId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4-6. link-to-existing
// ---------------------------------------------------------------------------

describe('link-to-existing outcomes', () => {
  it('4. with selectedExistingRecordId becomes ready-to-link', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('link-to-existing', { selectedExistingRecordId: 'e1' }),
      ],
    });
    const row = result.rows[0];
    expect(row.planStatus).toBe('ready-to-link');
    expect(row.plannedOperation).toBe('link-existing-record');
    expect(row.targetExistingRecordId).toBe('e1');
    expect(row.reasons).toEqual(['accepted-candidate-link']);
    expect(row.blockers).toEqual([]);
  });

  it('5. with manualExistingRecordId becomes ready-to-link', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('link-to-existing', { manualExistingRecordId: 'ext-42' }),
      ],
    });
    const row = result.rows[0];
    expect(row.planStatus).toBe('ready-to-link');
    expect(row.targetExistingRecordId).toBe('ext-42');
    expect(row.reasons).toEqual(['manual-link']);
  });

  it('6. without any target id becomes blocked', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('link-to-existing')],
    });
    const row = result.rows[0];
    expect(row.planStatus).toBe('blocked-unresolved');
    expect(row.plannedOperation).toBe('none');
    expect(row.blockers).toEqual(['missing-target-existing-record-id']);
    expect(result.canCommit).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7-9. create-new / rejected / deferred
// ---------------------------------------------------------------------------

describe('create / reject / defer outcomes', () => {
  it('7. create-new becomes ready-to-create (no roster write)', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('create-new', { sourceEntryStatus: 'no-match' })],
    });
    expect(result.rows[0].planStatus).toBe('ready-to-create');
    expect(result.rows[0].plannedOperation).toBe('create-new-roster-entry');
  });

  it('8. rejected becomes rejected and does not delete the row', () => {
    const entry = applied('rejected');
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [entry],
    });
    expect(result.rows[0].planStatus).toBe('rejected');
    expect(result.rows[0].plannedOperation).toBe('reject-import-row');
    // the source row is preserved by reference, not removed
    expect(result.rows[0].originalAppliedEntry).toBe(entry);
  });

  it('9. deferred becomes deferred and does not delete the row', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('deferred')],
    });
    expect(result.rows[0].planStatus).toBe('deferred');
    expect(result.rows[0].plannedOperation).toBe('defer-review');
  });
});

// ---------------------------------------------------------------------------
// 10-12. conflict / skipped
// ---------------------------------------------------------------------------

describe('conflict and skipped outcomes', () => {
  it('10. conflict becomes blocked-conflict', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('conflict', { sourceEntryStatus: 'multiple-candidates' })],
    });
    expect(result.rows[0].planStatus).toBe('blocked-conflict');
    expect(result.rows[0].blockers).toEqual(['conflicting-decisions']);
  });

  it('11. skipped-invalid-preview-row becomes blocked-invalid-preview-row', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('skipped-invalid-preview-row', {
          sourceEntryStatus: 'skipped-invalid-preview-row',
        }),
      ],
    });
    expect(result.rows[0].planStatus).toBe('blocked-invalid-preview-row');
    expect(result.rows[0].blockers).toEqual(['invalid-preview-row']);
  });

  it('12. skipped-review-preview-row becomes blocked-review-preview-row', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('skipped-review-preview-row', {
          sourceEntryStatus: 'skipped-review-preview-row',
        }),
      ],
    });
    expect(result.rows[0].planStatus).toBe('blocked-review-preview-row');
    expect(result.rows[0].blockers).toEqual(['preview-row-needs-review']);
  });
});

// ---------------------------------------------------------------------------
// 13-16. commit gating
// ---------------------------------------------------------------------------

describe('commit gating', () => {
  it('13. rejected and deferred do not block the commit preview', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('create-new', { previewSourceRowId: 'a', previewRowIndex: 0, sourceEntryStatus: 'no-match' }),
        applied('rejected', { previewSourceRowId: 'b', previewRowIndex: 1 }),
        applied('deferred', { previewSourceRowId: 'c', previewRowIndex: 2 }),
      ],
    });
    expect(result.summary.blockingRows).toBe(0);
    expect(result.canCommit).toBe(true);
  });

  it('14. any blocked row makes canCommit false', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('create-new', { previewSourceRowId: 'a', previewRowIndex: 0, sourceEntryStatus: 'no-match' }),
        applied('unresolved', { previewSourceRowId: 'b', previewRowIndex: 1 }),
      ],
    });
    expect(result.canCommit).toBe(false);
    expect(result.summary.blockingRows).toBe(1);
  });

  it('15. all ready/rejected/deferred rows makes canCommit true', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('link-to-existing', { previewSourceRowId: 'a', previewRowIndex: 0, selectedExistingRecordId: 'e1' }),
        applied('create-new', { previewSourceRowId: 'b', previewRowIndex: 1, sourceEntryStatus: 'no-match' }),
        applied('rejected', { previewSourceRowId: 'c', previewRowIndex: 2 }),
        applied('deferred', { previewSourceRowId: 'd', previewRowIndex: 3 }),
      ],
    });
    expect(result.canCommit).toBe(true);
  });

  it('16. invalid target context makes canCommit false without mutating rows', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('create-new', { sourceEntryStatus: 'no-match' }),
      ],
      targetContext: { seasonId: '2026', districtId: 'alta', ageDivisionId: 'GI' }, // teamId missing
    });
    expect(result.targetContextValid).toBe(false);
    expect(result.blockers).toEqual(['invalid-target-context']);
    expect(result.canCommit).toBe(false);
    // the row itself is still a clean ready-to-create (not mutated by the context blocker)
    expect(result.rows[0].planStatus).toBe('ready-to-create');
    expect(result.summary.canCommit).toBe(true); // row-level readiness unaffected
  });

  it('valid target context allows commit', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [applied('create-new', { sourceEntryStatus: 'no-match' })],
      targetContext: TARGET,
    });
    expect(result.targetContextValid).toBe(true);
    expect(result.canCommit).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 17. ordering
// ---------------------------------------------------------------------------

describe('ordering', () => {
  it('17. row ordering follows applied entry input order', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('create-new', { previewSourceRowId: 'c', previewRowIndex: 2, sourceEntryStatus: 'no-match' }),
        applied('create-new', { previewSourceRowId: 'a', previewRowIndex: 0, sourceEntryStatus: 'no-match' }),
        applied('create-new', { previewSourceRowId: 'b', previewRowIndex: 1, sourceEntryStatus: 'no-match' }),
      ],
    });
    expect(result.rows.map((r) => r.previewSourceRowId)).toEqual(['c', 'a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// 18-19. helpers
// ---------------------------------------------------------------------------

describe('plan row helpers', () => {
  const result = createRosterImportCommitPreviewPlan({
    appliedEntries: [
      applied('link-to-existing', { previewSourceRowId: 'a', previewRowIndex: 0, selectedExistingRecordId: 'e1' }),
      applied('create-new', { previewSourceRowId: 'b', previewRowIndex: 1, sourceEntryStatus: 'no-match' }),
      applied('rejected', { previewSourceRowId: 'c', previewRowIndex: 2 }),
      applied('unresolved', { previewSourceRowId: 'd', previewRowIndex: 3 }),
      applied('conflict', { previewSourceRowId: 'e', previewRowIndex: 4, sourceEntryStatus: 'multiple-candidates' }),
    ],
  });

  it('18. ready helper returns only ready-to-link and ready-to-create rows', () => {
    const ready = getRosterImportCommitPreviewPlanRowsReadyForCommit(result);
    expect(ready.map((r) => r.planStatus)).toEqual([
      'ready-to-link',
      'ready-to-create',
    ]);
  });

  it('19. blocking helper returns only blocked rows', () => {
    const blocking = getRosterImportCommitPreviewPlanRowsBlockingCommit(result);
    expect(blocking.map((r) => r.planStatus)).toEqual([
      'blocked-unresolved',
      'blocked-conflict',
    ]);
  });

  it('helpers accept a bare rows array too', () => {
    expect(
      getRosterImportCommitPreviewPlanRowsReadyForCommit(result.rows)
    ).toHaveLength(2);
    expect(
      getRosterImportCommitPreviewPlanRowsBlockingCommit(result.rows)
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 20. summary
// ---------------------------------------------------------------------------

describe('summarizeRosterImportCommitPreviewPlanRows', () => {
  it('20. counts statuses, operations, blockers, and canCommit accurately', () => {
    const result = createRosterImportCommitPreviewPlan({
      appliedEntries: [
        applied('link-to-existing', { previewSourceRowId: 'a', previewRowIndex: 0, selectedExistingRecordId: 'e1' }),
        applied('create-new', { previewSourceRowId: 'b', previewRowIndex: 1, sourceEntryStatus: 'no-match' }),
        applied('rejected', { previewSourceRowId: 'c', previewRowIndex: 2 }),
        applied('deferred', { previewSourceRowId: 'd', previewRowIndex: 3 }),
        applied('unresolved', { previewSourceRowId: 'e', previewRowIndex: 4 }),
        applied('conflict', { previewSourceRowId: 'f', previewRowIndex: 5, sourceEntryStatus: 'multiple-candidates' }),
        applied('skipped-invalid-preview-row', { previewSourceRowId: 'g', previewRowIndex: 6, sourceEntryStatus: 'skipped-invalid-preview-row' }),
        applied('skipped-review-preview-row', { previewSourceRowId: 'h', previewRowIndex: 7, sourceEntryStatus: 'skipped-review-preview-row' }),
      ],
    });
    const summary = result.summary;
    expect(summary.totalRows).toBe(8);
    expect(summary.readyToLinkRows).toBe(1);
    expect(summary.readyToCreateRows).toBe(1);
    expect(summary.rejectedRows).toBe(1);
    expect(summary.deferredRows).toBe(1);
    expect(summary.blockedUnresolvedRows).toBe(1);
    expect(summary.blockedConflictRows).toBe(1);
    expect(summary.blockedInvalidPreviewRows).toBe(1);
    expect(summary.blockedReviewPreviewRows).toBe(1);
    expect(summary.blockingRows).toBe(4);
    expect(summary.plannedLinkOperations).toBe(1);
    expect(summary.plannedCreateOperations).toBe(1);
    expect(summary.plannedRejectOperations).toBe(1);
    expect(summary.plannedDeferOperations).toBe(1);
    expect(summary.blockerCount).toBe(4);
    expect(summary.canCommit).toBe(false);
    // consistent when recomputed directly on rows
    expect(summarizeRosterImportCommitPreviewPlanRows(result.rows)).toEqual(
      summary
    );
  });
});

// ---------------------------------------------------------------------------
// 21-22. immutability
// ---------------------------------------------------------------------------

describe('immutability', () => {
  it('21. does not mutate the input applied entries', () => {
    const entries = [
      applied('link-to-existing', { selectedExistingRecordId: 'e1' }),
    ];
    const snapshot = JSON.parse(JSON.stringify(entries));
    createRosterImportCommitPreviewPlan({ appliedEntries: entries });
    expect(JSON.parse(JSON.stringify(entries))).toEqual(snapshot);
  });

  it('22. does not mutate nested original entries / candidates', () => {
    const entry = applied('link-to-existing', { selectedExistingRecordId: 'e1' });
    const original = entry.originalEntry;
    const candidateSnapshot = JSON.parse(JSON.stringify(original.candidates));
    const result = createRosterImportCommitPreviewPlan({ appliedEntries: [entry] });
    // nested original entry is shared by reference, never mutated
    expect(result.rows[0].originalAppliedEntry.originalEntry).toBe(original);
    expect(JSON.parse(JSON.stringify(original.candidates))).toEqual(
      candidateSnapshot
    );
  });
});

// ---------------------------------------------------------------------------
// 23. determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('23. produces identical output across repeated calls', () => {
    const input = {
      appliedEntries: [
        applied('link-to-existing', { previewSourceRowId: 'a', previewRowIndex: 0, selectedExistingRecordId: 'e1' }),
        applied('unresolved', { previewSourceRowId: 'b', previewRowIndex: 1 }),
        applied('rejected', { previewSourceRowId: 'c', previewRowIndex: 2 }),
      ],
      targetContext: TARGET,
    };
    const a = createRosterImportCommitPreviewPlan(input);
    const b = createRosterImportCommitPreviewPlan(input);
    expect(a).toEqual(b);
  });
});
