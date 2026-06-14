import { describe, it, expect } from 'vitest';
import {
  applyRosterImportIdentityReviewAction,
  createRosterImportIdentityReviewDecision,
  validateRosterImportIdentityReviewDecision,
  summarizeRosterImportIdentityReviewDecisions,
  ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_LOGIC_VERSION,
} from '../engine/rosterImportIdentityReviewDecision';
import type {
  RosterImportIdentityReviewAction,
  RosterImportIdentityReviewActionResult,
  RosterImportIdentityReviewDecision,
} from '../engine/rosterImportIdentityReviewDecision';
import type {
  RosterImportPreviewIdentityMatchEntry,
  RosterImportPreviewIdentityMatchCandidate,
  RosterImportPreviewIdentityMatchStatus,
} from '../engine/rosterImportPreviewIdentityMatch';

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
  candidates: RosterImportPreviewIdentityMatchCandidate[] = [],
  overrides: Partial<RosterImportPreviewIdentityMatchEntry> = {}
): RosterImportPreviewIdentityMatchEntry {
  return {
    previewSourceRowId: 'r1',
    previewRowIndex: 0,
    previewPlayerName: 'Jordan Smith',
    previewNormalizedIdentityKey: 'jordan smith',
    status,
    candidates,
    issues: [],
    ...overrides,
  };
}

function action(
  a: RosterImportIdentityReviewAction['action'],
  extra: Partial<RosterImportIdentityReviewAction> = {}
): RosterImportIdentityReviewAction {
  return { action: a, previewSourceRowId: 'r1', previewRowIndex: 0, ...extra };
}

const OPTIONS = {
  decisionId: 'dec-1',
  createdAt: '2026-06-13T00:00:00Z',
  reviewedAt: '2026-06-13T00:00:00Z',
  reviewedBy: 'coach-1',
};

function acceptedResult(
  a: RosterImportIdentityReviewAction['action'],
  e: RosterImportPreviewIdentityMatchEntry,
  extra: Partial<RosterImportIdentityReviewAction> = {}
): RosterImportIdentityReviewActionResult {
  const result = applyRosterImportIdentityReviewAction(e, action(a, extra));
  expect(result.accepted).toBe(true);
  return result;
}

// ---------------------------------------------------------------------------
// 1-3. accept-candidate
// ---------------------------------------------------------------------------

describe('applyRosterImportIdentityReviewAction - accept-candidate', () => {
  it('1. accepts for a single-candidate entry with a matching candidate id', () => {
    const result = applyRosterImportIdentityReviewAction(
      entry('single-candidate', [candidate('e1')]),
      action('accept-candidate', { selectedExistingRecordId: 'e1' })
    );
    expect(result.accepted).toBe(true);
    expect(result.effect).toBe('link-to-existing');
    expect(result.selectedExistingRecordId).toBe('e1');
    expect(result.reasonCodes).toEqual(['accept-candidate-confirmed']);
  });

  it('2. rejects when selectedExistingRecordId is missing', () => {
    const result = applyRosterImportIdentityReviewAction(
      entry('single-candidate', [candidate('e1')]),
      action('accept-candidate')
    );
    expect(result.accepted).toBe(false);
    expect(result.effect).toBe('no-effect');
    expect(result.reasonCodes).toEqual(['missing-selected-existing-record-id']);
  });

  it('3. rejects when selected candidate is not among candidates', () => {
    const result = applyRosterImportIdentityReviewAction(
      entry('multiple-candidates', [candidate('e1'), candidate('e2')]),
      action('accept-candidate', { selectedExistingRecordId: 'e9' })
    );
    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['selected-candidate-not-found']);
  });
});

// ---------------------------------------------------------------------------
// 4. reject-candidates
// ---------------------------------------------------------------------------

describe('applyRosterImportIdentityReviewAction - reject-candidates', () => {
  it('4. accepts for candidate-bearing entries with reject-import-row effect', () => {
    const single = applyRosterImportIdentityReviewAction(
      entry('single-candidate', [candidate('e1')]),
      action('reject-candidates')
    );
    expect(single.accepted).toBe(true);
    expect(single.effect).toBe('reject-import-row');

    const multi = applyRosterImportIdentityReviewAction(
      entry('multiple-candidates', [candidate('e1'), candidate('e2')]),
      action('reject-candidates')
    );
    expect(multi.accepted).toBe(true);
    expect(multi.effect).toBe('reject-import-row');
  });
});

// ---------------------------------------------------------------------------
// 5-6. manual-link
// ---------------------------------------------------------------------------

describe('applyRosterImportIdentityReviewAction - manual-link', () => {
  it('5. accepts when manualExistingRecordId is present', () => {
    const result = applyRosterImportIdentityReviewAction(
      entry('no-match'),
      action('manual-link', { manualExistingRecordId: 'ext-42' })
    );
    expect(result.accepted).toBe(true);
    expect(result.effect).toBe('link-to-existing');
    expect(result.manualExistingRecordId).toBe('ext-42');
    expect(result.reasonCodes).toEqual(['manual-link-recorded']);
  });

  it('6. rejects when manualExistingRecordId is missing', () => {
    const result = applyRosterImportIdentityReviewAction(
      entry('no-match'),
      action('manual-link')
    );
    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['missing-manual-existing-record-id']);
  });
});

// ---------------------------------------------------------------------------
// 7-8. create-new
// ---------------------------------------------------------------------------

describe('applyRosterImportIdentityReviewAction - create-new', () => {
  it('7. accepts for a no-match entry', () => {
    const result = applyRosterImportIdentityReviewAction(
      entry('no-match'),
      action('create-new')
    );
    expect(result.accepted).toBe(true);
    expect(result.effect).toBe('create-new-roster-entry');
    expect(result.reasonCodes).toEqual(['create-new-recorded']);
  });

  it('8. accepts for a candidate-bearing entry as a future instruction only', () => {
    const candidates = [candidate('e1'), candidate('e2')];
    const frozen = JSON.parse(JSON.stringify(candidates));
    const e = entry('multiple-candidates', candidates);
    const result = applyRosterImportIdentityReviewAction(
      e,
      action('create-new')
    );
    expect(result.accepted).toBe(true);
    expect(result.effect).toBe('create-new-roster-entry');
    // candidates / existing records are untouched
    expect(JSON.parse(JSON.stringify(candidates))).toEqual(frozen);
  });
});

// ---------------------------------------------------------------------------
// 9. defer
// ---------------------------------------------------------------------------

describe('applyRosterImportIdentityReviewAction - defer', () => {
  it('9. accepts for any entry status with defer-review effect', () => {
    const statuses: RosterImportPreviewIdentityMatchStatus[] = [
      'no-match',
      'single-candidate',
      'multiple-candidates',
      'skipped-invalid-preview-row',
      'skipped-review-preview-row',
    ];
    for (const status of statuses) {
      const result = applyRosterImportIdentityReviewAction(
        entry(status, status.startsWith('single') ? [candidate('e1')] : []),
        action('defer')
      );
      expect(result.accepted).toBe(true);
      expect(result.effect).toBe('defer-review');
    }
  });
});

// ---------------------------------------------------------------------------
// 10-11. skipped rows only allow defer
// ---------------------------------------------------------------------------

describe('applyRosterImportIdentityReviewAction - skipped rows', () => {
  it('10. skipped-invalid-preview-row allows only defer', () => {
    const e = entry('skipped-invalid-preview-row');
    expect(
      applyRosterImportIdentityReviewAction(e, action('defer')).accepted
    ).toBe(true);
    for (const a of [
      'accept-candidate',
      'reject-candidates',
      'manual-link',
      'create-new',
    ] as const) {
      const result = applyRosterImportIdentityReviewAction(
        e,
        action(a, {
          selectedExistingRecordId: 'e1',
          manualExistingRecordId: 'e1',
        })
      );
      expect(result.accepted).toBe(false);
      expect(result.reasonCodes).toEqual(['action-not-allowed-for-entry-status']);
    }
  });

  it('11. skipped-review-preview-row allows only defer', () => {
    const e = entry('skipped-review-preview-row');
    expect(
      applyRosterImportIdentityReviewAction(e, action('defer')).accepted
    ).toBe(true);
    const result = applyRosterImportIdentityReviewAction(
      e,
      action('create-new')
    );
    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['action-not-allowed-for-entry-status']);
  });
});

// ---------------------------------------------------------------------------
// 12. action result does not mutate entry/action
// ---------------------------------------------------------------------------

describe('applyRosterImportIdentityReviewAction - purity', () => {
  it('12. does not mutate the entry or action', () => {
    const e = entry('single-candidate', [candidate('e1')]);
    const a = action('accept-candidate', { selectedExistingRecordId: 'e1' });
    const eSnap = JSON.parse(JSON.stringify(e));
    const aSnap = JSON.parse(JSON.stringify(a));
    applyRosterImportIdentityReviewAction(e, a);
    expect(JSON.parse(JSON.stringify(e))).toEqual(eSnap);
    expect(JSON.parse(JSON.stringify(a))).toEqual(aSnap);
  });
});

// ---------------------------------------------------------------------------
// 13-16. decision creation
// ---------------------------------------------------------------------------

describe('createRosterImportIdentityReviewDecision', () => {
  it('13. creates a valid decision from an accepted action result', () => {
    const result = acceptedResult(
      'accept-candidate',
      entry('single-candidate', [candidate('e1')]),
      { selectedExistingRecordId: 'e1', note: 'looks right' }
    );
    const created = createRosterImportIdentityReviewDecision(result, OPTIONS);
    expect(created.created).toBe(true);
    expect(created.reason).toBe('created');
    const decision = created.decision!;
    expect(decision.decisionId).toBe('dec-1');
    expect(decision.action).toBe('accept-candidate');
    expect(decision.effect).toBe('link-to-existing');
    expect(decision.selectedExistingRecordId).toBe('e1');
    expect(decision.note).toBe('looks right');
    expect(decision.audit.logicVersion).toBe(
      ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_LOGIC_VERSION
    );
    expect(decision.audit.sourceEntryStatus).toBe('single-candidate');
    expect(validateRosterImportIdentityReviewDecision(decision).valid).toBe(
      true
    );
  });

  it('14. refuses to create a decision from a rejected action result', () => {
    const rejected = applyRosterImportIdentityReviewAction(
      entry('single-candidate', [candidate('e1')]),
      action('accept-candidate') // missing selected id -> rejected
    );
    const created = createRosterImportIdentityReviewDecision(rejected, OPTIONS);
    expect(created.created).toBe(false);
    expect(created.reason).toBe('rejected-action-cannot-create-decision');
    expect(created.decision).toBeNull();
  });

  it('15. rejects a missing decisionId', () => {
    const result = acceptedResult('defer', entry('no-match'));
    const created = createRosterImportIdentityReviewDecision(result, {
      ...OPTIONS,
      decisionId: '   ',
    });
    expect(created.created).toBe(false);
    expect(created.reason).toBe('missing-decision-id');
  });

  it('16. rejects a missing createdAt or reviewedAt', () => {
    const result = acceptedResult('defer', entry('no-match'));
    expect(
      createRosterImportIdentityReviewDecision(result, {
        ...OPTIONS,
        createdAt: '',
      }).reason
    ).toBe('missing-created-at');
    expect(
      createRosterImportIdentityReviewDecision(result, {
        ...OPTIONS,
        reviewedAt: '',
      }).reason
    ).toBe('missing-reviewed-at');
  });
});

// ---------------------------------------------------------------------------
// 17-18. decision validation
// ---------------------------------------------------------------------------

describe('validateRosterImportIdentityReviewDecision', () => {
  function validDecision(): RosterImportIdentityReviewDecision {
    const result = acceptedResult('create-new', entry('no-match'));
    return createRosterImportIdentityReviewDecision(result, OPTIONS).decision!;
  }

  it('17. accepts a valid decision', () => {
    expect(
      validateRosterImportIdentityReviewDecision(validDecision())
    ).toEqual({ valid: true, errors: [] });
  });

  it('18. rejects a malformed decision', () => {
    const malformed: RosterImportIdentityReviewDecision = {
      ...validDecision(),
      decisionId: '',
      effect: 'link-to-existing', // incoherent with action create-new + no target
    };
    const validation = validateRosterImportIdentityReviewDecision(malformed);
    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('missing-decision-id');
    expect(validation.errors).toContain('incoherent-action-and-effect');
    expect(validation.errors).toContain('link-effect-missing-target');
  });
});

// ---------------------------------------------------------------------------
// 19. supersedesDecisionId is preserved as append-only audit metadata
// ---------------------------------------------------------------------------

describe('createRosterImportIdentityReviewDecision - supersession', () => {
  it('19. preserves supersedesDecisionId without mutating the prior decision', () => {
    const first = createRosterImportIdentityReviewDecision(
      acceptedResult('defer', entry('no-match')),
      OPTIONS
    ).decision!;
    const firstSnap = JSON.parse(JSON.stringify(first));

    const second = createRosterImportIdentityReviewDecision(
      acceptedResult('create-new', entry('no-match')),
      { ...OPTIONS, decisionId: 'dec-2', supersedesDecisionId: 'dec-1' }
    ).decision!;

    expect(second.audit.supersedesDecisionId).toBe('dec-1');
    // the prior decision is untouched (append-only)
    expect(JSON.parse(JSON.stringify(first))).toEqual(firstSnap);
    expect(first.audit.supersedesDecisionId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 20. summary counts
// ---------------------------------------------------------------------------

describe('summarizeRosterImportIdentityReviewDecisions', () => {
  it('20. counts actions, effects, supersession, notes, and invalid decisions', () => {
    const accept = createRosterImportIdentityReviewDecision(
      acceptedResult('accept-candidate', entry('single-candidate', [candidate('e1')]), {
        selectedExistingRecordId: 'e1',
        note: 'ok',
      }),
      OPTIONS
    ).decision!;
    const createNew = createRosterImportIdentityReviewDecision(
      acceptedResult('create-new', entry('no-match')),
      { ...OPTIONS, decisionId: 'dec-2', supersedesDecisionId: 'dec-1' }
    ).decision!;
    const deferred = createRosterImportIdentityReviewDecision(
      acceptedResult('defer', entry('multiple-candidates', [candidate('e1'), candidate('e2')])),
      { ...OPTIONS, decisionId: 'dec-3' }
    ).decision!;
    const broken: RosterImportIdentityReviewDecision = {
      ...deferred,
      decisionId: '',
    };

    const summary = summarizeRosterImportIdentityReviewDecisions([
      accept,
      createNew,
      deferred,
      broken,
    ]);
    expect(summary.total).toBe(4);
    expect(summary.byAction.acceptCandidate).toBe(1);
    expect(summary.byAction.createNew).toBe(1);
    expect(summary.byAction.defer).toBe(2);
    expect(summary.byEffect.linkToExisting).toBe(1);
    expect(summary.byEffect.createNewRosterEntry).toBe(1);
    expect(summary.byEffect.deferReview).toBe(2);
    expect(summary.superseding).toBe(1);
    expect(summary.withNote).toBe(1);
    expect(summary.invalid).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 21. deterministic output across repeated calls
// ---------------------------------------------------------------------------

describe('rosterImportIdentityReviewDecision - determinism', () => {
  it('21. produces identical output across repeated calls', () => {
    const e = entry('multiple-candidates', [candidate('e1'), candidate('e2')]);
    const a = action('accept-candidate', {
      selectedExistingRecordId: 'e2',
      note: 'same',
    });

    const r1 = applyRosterImportIdentityReviewAction(e, a);
    const r2 = applyRosterImportIdentityReviewAction(e, a);
    expect(r1).toEqual(r2);

    const d1 = createRosterImportIdentityReviewDecision(r1, OPTIONS);
    const d2 = createRosterImportIdentityReviewDecision(r2, OPTIONS);
    expect(d1).toEqual(d2);
  });
});

// ---------------------------------------------------------------------------
// invalid action type
// ---------------------------------------------------------------------------

describe('applyRosterImportIdentityReviewAction - invalid action', () => {
  it('rejects an unknown action type', () => {
    const result = applyRosterImportIdentityReviewAction(
      entry('single-candidate', [candidate('e1')]),
      { action: 'bogus' as RosterImportIdentityReviewAction['action'] }
    );
    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['invalid-action']);
  });

  it('rejects any action when the entry has no stable preview row key', () => {
    const result = applyRosterImportIdentityReviewAction(
      entry('skipped-invalid-preview-row', [], { previewSourceRowId: null }),
      action('defer')
    );
    expect(result.accepted).toBe(false);
    expect(result.reasonCodes).toEqual(['missing-preview-row-key']);
  });
});
