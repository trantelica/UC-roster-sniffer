import { describe, it, expect } from 'vitest';
import {
  applyRosterImportIdentityReviewDecisionsToMatches,
  summarizeAppliedRosterImportIdentityReviewDecisions,
} from '../engine/rosterImportIdentityReviewDecisionApplication';
import type {
  RosterImportPreviewIdentityMatchEntry,
  RosterImportPreviewIdentityMatchCandidate,
  RosterImportPreviewIdentityMatchStatus,
} from '../engine/rosterImportPreviewIdentityMatch';
import type {
  RosterImportIdentityReviewDecision,
  RosterImportIdentityReviewActionType,
  RosterImportIdentityReviewActionEffect,
} from '../engine/rosterImportIdentityReviewDecision';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function candidate(
  existingRecordId: string
): RosterImportPreviewIdentityMatchCandidate {
  return {
    previewSourceRowId: 'r1',
    previewRowIndex: 0,
    existingRecordId,
    existingPlayerName: 'Jordan Smith',
    matchType: 'exact-identity-key',
    confidence: 'high',
    reasons: ['exact-normalized-name-match'],
  };
}

function entry(
  status: RosterImportPreviewIdentityMatchStatus,
  overrides: Partial<RosterImportPreviewIdentityMatchEntry> = {}
): RosterImportPreviewIdentityMatchEntry {
  return {
    previewSourceRowId: 'r1',
    previewRowIndex: 0,
    previewPlayerName: 'Jordan Smith',
    previewNormalizedIdentityKey: 'jordan smith',
    status,
    candidates: [],
    issues: [],
    ...overrides,
  };
}

const EFFECT_BY_ACTION: Record<
  RosterImportIdentityReviewActionType,
  RosterImportIdentityReviewActionEffect
> = {
  'accept-candidate': 'link-to-existing',
  'manual-link': 'link-to-existing',
  'reject-candidates': 'reject-import-row',
  'create-new': 'create-new-roster-entry',
  defer: 'defer-review',
};

function decision(
  decisionId: string,
  action: RosterImportIdentityReviewActionType,
  overrides: Partial<RosterImportIdentityReviewDecision> = {}
): RosterImportIdentityReviewDecision {
  return {
    decisionId,
    previewSourceRowId: 'r1',
    previewRowIndex: 0,
    action,
    effect: EFFECT_BY_ACTION[action],
    selectedExistingRecordId: null,
    manualExistingRecordId: null,
    reasonCodes: [],
    createdAt: '2026-06-13T00:00:00Z',
    reviewedAt: '2026-06-13T00:00:00Z',
    audit: {
      logicVersion: 'phase5-slice3-import-identity-review-decision-v1',
      sourceEntryStatus: 'single-candidate',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. empty
// ---------------------------------------------------------------------------

describe('applyRosterImportIdentityReviewDecisionsToMatches - empty', () => {
  it('1. returns a deterministic empty result', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches([], []);
    expect(result.entries).toEqual([]);
    expect(result.ignoredDecisions).toEqual([]);
    expect(result.summary.totalEntries).toBe(0);
    expect(result.summary.ignoredDecisions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2-3. no decisions
// ---------------------------------------------------------------------------

describe('no decisions', () => {
  it('2. matchable entries are unresolved; skipped rows map to skip outcomes', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [
        entry('no-match', { previewSourceRowId: 'a', previewRowIndex: 0 }),
        entry('single-candidate', {
          previewSourceRowId: 'b',
          previewRowIndex: 1,
          candidates: [candidate('e1')],
        }),
        entry('multiple-candidates', {
          previewSourceRowId: 'c',
          previewRowIndex: 2,
          candidates: [candidate('e1'), candidate('e2')],
        }),
        entry('skipped-invalid-preview-row', {
          previewSourceRowId: 'd',
          previewRowIndex: 3,
        }),
        entry('skipped-review-preview-row', {
          previewSourceRowId: 'e',
          previewRowIndex: 4,
        }),
      ],
      []
    );
    expect(result.entries.map((e) => e.effectiveOutcome)).toEqual([
      'unresolved',
      'unresolved',
      'unresolved',
      'skipped-invalid-preview-row',
      'skipped-review-preview-row',
    ]);
  });

  it('3. single-candidate high-confidence is not auto-linked', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('single-candidate', { candidates: [candidate('e1')] })],
      []
    );
    expect(result.entries[0].effectiveOutcome).toBe('unresolved');
    expect(result.entries[0].appliedDecisionId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4-5. accept-candidate
// ---------------------------------------------------------------------------

describe('accept-candidate', () => {
  it('4. links to the selected existing record', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('single-candidate', { candidates: [candidate('e1')] })],
      [decision('d1', 'accept-candidate', { selectedExistingRecordId: 'e1' })]
    );
    const e = result.entries[0];
    expect(e.effectiveOutcome).toBe('link-to-existing');
    expect(e.selectedExistingRecordId).toBe('e1');
    expect(e.appliedDecisionId).toBe('d1');
    expect(e.effectiveConfidence).toBe('high');
  });

  it('5. ignores accept-candidate when the selected candidate is absent (chosen contract)', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('single-candidate', { candidates: [candidate('e1')] })],
      [decision('d1', 'accept-candidate', { selectedExistingRecordId: 'e9' })]
    );
    expect(result.entries[0].effectiveOutcome).toBe('unresolved');
    expect(result.entries[0].appliedDecisionId).toBeNull();
    expect(result.ignoredDecisions).toHaveLength(1);
    expect(result.ignoredDecisions[0].reason).toBe('selected-candidate-not-found');
  });
});

// ---------------------------------------------------------------------------
// 6-9. other actions
// ---------------------------------------------------------------------------

describe('other actions', () => {
  it('6. manual-link links to the manual existing record', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('no-match')],
      [decision('d1', 'manual-link', { manualExistingRecordId: 'ext-42' })]
    );
    const e = result.entries[0];
    expect(e.effectiveOutcome).toBe('link-to-existing');
    expect(e.manualExistingRecordId).toBe('ext-42');
    expect(e.appliedDecisionId).toBe('d1');
  });

  it('7. create-new produces a create-new outcome (no roster write)', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('no-match')],
      [decision('d1', 'create-new')]
    );
    expect(result.entries[0].effectiveOutcome).toBe('create-new');
  });

  it('8. reject-candidates produces a rejected outcome (row preserved)', () => {
    const e = entry('single-candidate', { candidates: [candidate('e1')] });
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [e],
      [decision('d1', 'reject-candidates')]
    );
    expect(result.entries[0].effectiveOutcome).toBe('rejected');
    // the source entry (the "row") is preserved by reference, not removed
    expect(result.entries[0].originalEntry).toBe(e);
  });

  it('9. defer produces a deferred outcome', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('multiple-candidates', { candidates: [candidate('e1'), candidate('e2')] })],
      [decision('d1', 'defer')]
    );
    expect(result.entries[0].effectiveOutcome).toBe('deferred');
    expect(result.entries[0].effectiveConfidence).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// 10-11. skipped rows do not apply disallowed decisions
// ---------------------------------------------------------------------------

describe('skipped rows', () => {
  it('10. skipped-invalid maps to skip outcome and ignores the decision', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('skipped-invalid-preview-row')],
      [decision('d1', 'create-new')]
    );
    expect(result.entries[0].effectiveOutcome).toBe('skipped-invalid-preview-row');
    expect(result.entries[0].appliedDecisionId).toBeNull();
    expect(result.ignoredDecisions[0].reason).toBe('decision-entry-status-mismatch');
  });

  it('11. skipped-review maps to skip outcome and ignores the decision', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('skipped-review-preview-row')],
      [decision('d1', 'defer')]
    );
    expect(result.entries[0].effectiveOutcome).toBe('skipped-review-preview-row');
    expect(result.ignoredDecisions[0].reason).toBe('decision-entry-status-mismatch');
  });
});

// ---------------------------------------------------------------------------
// 12-15. ignored decisions
// ---------------------------------------------------------------------------

describe('ignored decisions', () => {
  it('12. invalid decision is ignored and reported', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('no-match')],
      [decision('', 'create-new', { decisionId: '' })] // missing id -> invalid
    );
    expect(result.entries[0].effectiveOutcome).toBe('unresolved');
    expect(result.ignoredDecisions[0].reason).toBe('invalid-decision');
    expect(result.ignoredDecisions[0].validationErrors).toContain(
      'missing-decision-id'
    );
  });

  it('13. superseded decision is ignored and reported', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('no-match')],
      [
        decision('d1', 'create-new'),
        decision('d2', 'defer', {
          audit: {
            logicVersion: 'phase5-slice3-import-identity-review-decision-v1',
            sourceEntryStatus: 'no-match',
            supersedesDecisionId: 'd1',
          },
        }),
      ]
    );
    // d1 superseded -> ignored; d2 applied
    expect(result.entries[0].effectiveOutcome).toBe('deferred');
    expect(
      result.ignoredDecisions.find((i) => i.decisionId === 'd1')?.reason
    ).toBe('superseded-decision');
  });

  it('14. no-matching-entry decision is ignored and reported', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('no-match', { previewSourceRowId: 'a', previewRowIndex: 0 })],
      [decision('d1', 'create-new', { previewSourceRowId: 'z', previewRowIndex: 9 })]
    );
    expect(result.entries[0].effectiveOutcome).toBe('unresolved');
    expect(result.ignoredDecisions[0].reason).toBe('no-matching-entry');
  });

  it('15. missing preview row key decision is ignored and reported', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('no-match')],
      [
        decision('d1', 'create-new', {
          previewSourceRowId: '' as unknown as string,
        }),
      ]
    );
    expect(result.ignoredDecisions[0].reason).toBe('missing-preview-row-key');
  });
});

// ---------------------------------------------------------------------------
// 16. conflict
// ---------------------------------------------------------------------------

describe('conflict', () => {
  it('16. duplicate current decisions for the same entry create a conflict', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('multiple-candidates', { candidates: [candidate('e1'), candidate('e2')] })],
      [
        decision('d1', 'accept-candidate', { selectedExistingRecordId: 'e1' }),
        decision('d2', 'accept-candidate', { selectedExistingRecordId: 'e2' }),
      ]
    );
    expect(result.entries[0].effectiveOutcome).toBe('conflict');
    expect(result.entries[0].appliedDecisionId).toBeNull();
    expect(result.entries[0].issues[0].code).toBe('duplicate-current-decision');
    expect(result.ignoredDecisions.map((i) => i.reason)).toEqual([
      'duplicate-current-decision',
      'duplicate-current-decision',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 17-18. ordering
// ---------------------------------------------------------------------------

describe('ordering', () => {
  it('17. entry ordering follows input entry order', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [
        entry('no-match', { previewSourceRowId: 'c', previewRowIndex: 2 }),
        entry('no-match', { previewSourceRowId: 'a', previewRowIndex: 0 }),
        entry('no-match', { previewSourceRowId: 'b', previewRowIndex: 1 }),
      ],
      []
    );
    expect(result.entries.map((e) => e.previewSourceRowId)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('18. ignored decision ordering follows decision input order', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [],
      [
        decision('d1', 'create-new', { previewSourceRowId: 'x', previewRowIndex: 0 }),
        decision('d2', 'create-new', { previewSourceRowId: 'y', previewRowIndex: 1 }),
        decision('d3', 'create-new', { previewSourceRowId: 'z', previewRowIndex: 2 }),
      ]
    );
    expect(result.ignoredDecisions.map((i) => i.decisionId)).toEqual([
      'd1',
      'd2',
      'd3',
    ]);
    expect(
      result.ignoredDecisions.every((i) => i.reason === 'no-matching-entry')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 19. summary
// ---------------------------------------------------------------------------

describe('summarizeAppliedRosterImportIdentityReviewDecisions', () => {
  it('19. counts outcomes and ignored reasons accurately', () => {
    const result = applyRosterImportIdentityReviewDecisionsToMatches(
      [
        entry('single-candidate', {
          previewSourceRowId: 'a',
          previewRowIndex: 0,
          candidates: [candidate('e1')],
        }),
        entry('no-match', { previewSourceRowId: 'b', previewRowIndex: 1 }),
        entry('multiple-candidates', {
          previewSourceRowId: 'c',
          previewRowIndex: 2,
          candidates: [candidate('e1'), candidate('e2')],
        }),
        entry('skipped-invalid-preview-row', {
          previewSourceRowId: 'd',
          previewRowIndex: 3,
        }),
      ],
      [
        decision('a1', 'accept-candidate', {
          previewSourceRowId: 'a',
          previewRowIndex: 0,
          selectedExistingRecordId: 'e1',
        }),
        // conflict on c
        decision('c1', 'defer', { previewSourceRowId: 'c', previewRowIndex: 2 }),
        decision('c2', 'create-new', { previewSourceRowId: 'c', previewRowIndex: 2 }),
        // no matching entry
        decision('z1', 'create-new', { previewSourceRowId: 'z', previewRowIndex: 9 }),
      ]
    );
    const summary = result.summary;
    expect(summary.totalEntries).toBe(4);
    expect(summary.linkToExisting).toBe(1);
    expect(summary.unresolved).toBe(1); // b
    expect(summary.conflict).toBe(1); // c
    expect(summary.skippedInvalid).toBe(1); // d
    expect(summary.decisionsApplied).toBe(1);
    expect(summary.duplicateCurrentDecision).toBe(2);
    expect(summary.noMatchingEntry).toBe(1);
    expect(summary.ignoredDecisions).toBe(3);
    // consistent when recomputed directly
    expect(
      summarizeAppliedRosterImportIdentityReviewDecisions(result)
    ).toEqual(summary);
  });
});

// ---------------------------------------------------------------------------
// 20-21. immutability
// ---------------------------------------------------------------------------

describe('immutability', () => {
  it('20. does not mutate input entries', () => {
    const entries = [
      entry('single-candidate', { candidates: [candidate('e1')] }),
    ];
    const snapshot = JSON.parse(JSON.stringify(entries));
    applyRosterImportIdentityReviewDecisionsToMatches(entries, [
      decision('d1', 'accept-candidate', { selectedExistingRecordId: 'e1' }),
    ]);
    expect(JSON.parse(JSON.stringify(entries))).toEqual(snapshot);
  });

  it('21. does not mutate input decisions', () => {
    const decisions = [
      decision('d1', 'accept-candidate', { selectedExistingRecordId: 'e1' }),
    ];
    const snapshot = JSON.parse(JSON.stringify(decisions));
    applyRosterImportIdentityReviewDecisionsToMatches(
      [entry('single-candidate', { candidates: [candidate('e1')] })],
      decisions
    );
    expect(JSON.parse(JSON.stringify(decisions))).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 22. determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('22. produces identical output across repeated calls', () => {
    const entries = [
      entry('single-candidate', {
        previewSourceRowId: 'a',
        previewRowIndex: 0,
        candidates: [candidate('e1')],
      }),
      entry('no-match', { previewSourceRowId: 'b', previewRowIndex: 1 }),
    ];
    const decisions = [
      decision('a1', 'accept-candidate', {
        previewSourceRowId: 'a',
        previewRowIndex: 0,
        selectedExistingRecordId: 'e1',
      }),
      decision('z1', 'create-new', { previewSourceRowId: 'z', previewRowIndex: 9 }),
    ];
    const a = applyRosterImportIdentityReviewDecisionsToMatches(entries, decisions);
    const b = applyRosterImportIdentityReviewDecisionsToMatches(entries, decisions);
    expect(a).toEqual(b);
  });
});
