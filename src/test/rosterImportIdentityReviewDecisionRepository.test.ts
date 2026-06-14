import { describe, it, expect } from 'vitest';
import {
  ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_REPOSITORY_VERSION,
  createEmptyRosterImportIdentityReviewDecisionRepositoryState,
  appendRosterImportIdentityReviewDecision,
  appendRosterImportIdentityReviewDecisions,
  getRosterImportIdentityReviewDecisions,
  getActiveRosterImportIdentityReviewDecisions,
  exportRosterImportIdentityReviewDecisionRepository,
  importRosterImportIdentityReviewDecisionRepository,
} from '../engine/rosterImportIdentityReviewDecisionRepository';
import type { RosterImportIdentityReviewDecision } from '../engine/rosterImportIdentityReviewDecision';

// ---------------------------------------------------------------------------
// Helpers — build a valid decision and let tests tweak it.
// ---------------------------------------------------------------------------

function decision(
  decisionId: string,
  overrides: Partial<RosterImportIdentityReviewDecision> = {}
): RosterImportIdentityReviewDecision {
  return {
    decisionId,
    previewSourceRowId: 'r1',
    previewRowIndex: 0,
    action: 'create-new',
    effect: 'create-new-roster-entry',
    selectedExistingRecordId: null,
    manualExistingRecordId: null,
    reasonCodes: ['create-new-recorded'],
    createdAt: '2026-06-13T00:00:00Z',
    reviewedAt: '2026-06-13T00:00:00Z',
    audit: {
      logicVersion: 'phase5-slice3-import-identity-review-decision-v1',
      sourceEntryStatus: 'no-match',
    },
    ...overrides,
  };
}

/** A decision that supersedes another via audit.supersedesDecisionId. */
function supersedingDecision(
  decisionId: string,
  supersedesDecisionId: string
): RosterImportIdentityReviewDecision {
  const base = decision(decisionId);
  return {
    ...base,
    audit: { ...base.audit, supersedesDecisionId },
  };
}

// ---------------------------------------------------------------------------
// 1. empty repository state
// ---------------------------------------------------------------------------

describe('createEmptyRosterImportIdentityReviewDecisionRepositoryState', () => {
  it('1. returns a versioned empty state', () => {
    const state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    expect(state).toEqual({
      version: ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_REPOSITORY_VERSION,
      decisions: [],
    });
  });
});

// ---------------------------------------------------------------------------
// 2-4. single append
// ---------------------------------------------------------------------------

describe('appendRosterImportIdentityReviewDecision', () => {
  it('2. appends a valid decision', () => {
    const state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    const result = appendRosterImportIdentityReviewDecision(state, decision('d1'));
    expect(result.ok).toBe(true);
    expect(result.accepted).toHaveLength(1);
    expect(result.state.decisions.map((d) => d.decisionId)).toEqual(['d1']);
  });

  it('3. rejects an invalid decision', () => {
    const state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    const result = appendRosterImportIdentityReviewDecision(
      state,
      decision('', { decisionId: '' }) // missing decision id -> invalid
    );
    expect(result.ok).toBe(false);
    expect(result.rejected[0].reason).toBe('invalid-decision');
    expect(result.rejected[0].validationErrors).toContain('missing-decision-id');
    expect(result.state.decisions).toHaveLength(0);
  });

  it('4. rejects a duplicate decisionId already in state', () => {
    let state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    state = appendRosterImportIdentityReviewDecision(state, decision('d1')).state;
    const result = appendRosterImportIdentityReviewDecision(state, decision('d1'));
    expect(result.ok).toBe(false);
    expect(result.rejected[0].reason).toBe('duplicate-decision-id');
    expect(result.state.decisions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 5-8. batch append
// ---------------------------------------------------------------------------

describe('appendRosterImportIdentityReviewDecisions', () => {
  it('5. supports valid decisions and preserves input order', () => {
    const state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    const result = appendRosterImportIdentityReviewDecisions(state, [
      decision('d3'),
      decision('d1'),
      decision('d2'),
    ]);
    expect(result.ok).toBe(true);
    expect(result.state.decisions.map((d) => d.decisionId)).toEqual([
      'd3',
      'd1',
      'd2',
    ]);
  });

  it('6. rejects invalid decisions while accepting valid ones', () => {
    const state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    const result = appendRosterImportIdentityReviewDecisions(state, [
      decision('d1'),
      decision('bad', { decisionId: '' }),
      decision('d2'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.accepted.map((d) => d.decisionId)).toEqual(['d1', 'd2']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toBe('invalid-decision');
    expect(result.state.decisions.map((d) => d.decisionId)).toEqual(['d1', 'd2']);
  });

  it('7. rejects duplicate IDs already in state', () => {
    let state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    state = appendRosterImportIdentityReviewDecisions(state, [decision('d1')]).state;
    const result = appendRosterImportIdentityReviewDecisions(state, [
      decision('d1'),
      decision('d2'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.accepted.map((d) => d.decisionId)).toEqual(['d2']);
    expect(result.rejected[0].reason).toBe('duplicate-decision-id');
    expect(result.state.decisions.map((d) => d.decisionId)).toEqual(['d1', 'd2']);
  });

  it('8. rejects duplicate IDs within the same batch', () => {
    const state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    const result = appendRosterImportIdentityReviewDecisions(state, [
      decision('d1'),
      decision('d1'),
    ]);
    expect(result.ok).toBe(false);
    expect(result.accepted.map((d) => d.decisionId)).toEqual(['d1']);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0].reason).toBe('duplicate-decision-id');
    expect(result.state.decisions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 9-11. get all vs active (supersession)
// ---------------------------------------------------------------------------

describe('get all vs active decisions', () => {
  function seeded() {
    let state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    state = appendRosterImportIdentityReviewDecisions(state, [
      decision('d1'),
      decision('d2'),
      supersedingDecision('d3', 'd1'),
    ]).state;
    return state;
  }

  it('9. get all decisions preserves append order', () => {
    expect(
      getRosterImportIdentityReviewDecisions(seeded()).map((d) => d.decisionId)
    ).toEqual(['d1', 'd2', 'd3']);
  });

  it('10. active decisions exclude superseded ones', () => {
    expect(
      getActiveRosterImportIdentityReviewDecisions(seeded()).map(
        (d) => d.decisionId
      )
    ).toEqual(['d2', 'd3']);
  });

  it('11. superseded decisions remain in the full history', () => {
    expect(
      getRosterImportIdentityReviewDecisions(seeded()).some(
        (d) => d.decisionId === 'd1'
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 12. export
// ---------------------------------------------------------------------------

describe('exportRosterImportIdentityReviewDecisionRepository', () => {
  it('12. returns a JSON-compatible payload', () => {
    let state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    state = appendRosterImportIdentityReviewDecisions(state, [
      decision('d1'),
      decision('d2'),
    ]).state;
    const payload = exportRosterImportIdentityReviewDecisionRepository(state);
    expect(payload.version).toBe(
      ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_REPOSITORY_VERSION
    );
    expect(payload.decisions.map((d) => d.decisionId)).toEqual(['d1', 'd2']);
    // round-trips through JSON unchanged
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });
});

// ---------------------------------------------------------------------------
// 13-17. import
// ---------------------------------------------------------------------------

describe('importRosterImportIdentityReviewDecisionRepository', () => {
  it('13. imports a valid repository payload', () => {
    const payload = {
      version: ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_REPOSITORY_VERSION,
      decisions: [decision('d1'), decision('d2')],
    };
    const result = importRosterImportIdentityReviewDecisionRepository(payload);
    expect(result.ok).toBe(true);
    expect(result.state.decisions.map((d) => d.decisionId)).toEqual(['d1', 'd2']);
  });

  it('14. rejects an unsupported version', () => {
    const result = importRosterImportIdentityReviewDecisionRepository({
      version: 'something-else.v9',
      decisions: [],
    });
    expect(result.ok).toBe(false);
    expect(result.rejected[0].reason).toBe('unsupported-repository-version');
    expect(result.state.decisions).toHaveLength(0);
  });

  it('15. rejects a payload missing the decisions list', () => {
    const result = importRosterImportIdentityReviewDecisionRepository({
      version: ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_REPOSITORY_VERSION,
    });
    expect(result.ok).toBe(false);
    expect(result.rejected[0].reason).toBe('missing-decision-list');
  });

  it('16. rejects an invalid (non-object) payload', () => {
    for (const bad of [null, 'x', 42, [decision('d1')]]) {
      const result = importRosterImportIdentityReviewDecisionRepository(bad);
      expect(result.ok).toBe(false);
      expect(result.rejected[0].reason).toBe('invalid-repository-payload');
    }
  });

  it('17. partially imports, reporting rejected entries', () => {
    const payload = {
      version: ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_REPOSITORY_VERSION,
      decisions: [
        decision('d1'),
        decision('bad', { decisionId: '' }), // invalid
        decision('d1'), // duplicate
        decision('d2'),
      ],
    };
    const result = importRosterImportIdentityReviewDecisionRepository(payload);
    expect(result.ok).toBe(false);
    expect(result.accepted.map((d) => d.decisionId)).toEqual(['d1', 'd2']);
    expect(result.rejected.map((r) => r.reason)).toEqual([
      'invalid-decision',
      'duplicate-decision-id',
    ]);
    expect(result.state.decisions.map((d) => d.decisionId)).toEqual(['d1', 'd2']);
  });
});

// ---------------------------------------------------------------------------
// 18-19. immutability
// ---------------------------------------------------------------------------

describe('repository immutability', () => {
  it('18. does not mutate the input state', () => {
    const state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    const snapshot = JSON.parse(JSON.stringify(state));
    appendRosterImportIdentityReviewDecision(state, decision('d1'));
    expect(JSON.parse(JSON.stringify(state))).toEqual(snapshot);
    expect(state.decisions).toHaveLength(0);
  });

  it('19. does not mutate decision objects (append or import)', () => {
    const d = decision('d1');
    const snapshot = JSON.parse(JSON.stringify(d));
    const state = createEmptyRosterImportIdentityReviewDecisionRepositoryState();
    const appended = appendRosterImportIdentityReviewDecision(state, d).state;
    // stored by reference, never mutated
    expect(appended.decisions[0]).toBe(d);
    expect(JSON.parse(JSON.stringify(d))).toEqual(snapshot);

    const payload = {
      version: ROSTER_IMPORT_IDENTITY_REVIEW_DECISION_REPOSITORY_VERSION,
      decisions: [decision('d2')],
    };
    const payloadSnapshot = JSON.parse(JSON.stringify(payload));
    importRosterImportIdentityReviewDecisionRepository(payload);
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payloadSnapshot);
  });
});

// ---------------------------------------------------------------------------
// 20. deterministic ordering across repeated calls
// ---------------------------------------------------------------------------

describe('repository determinism', () => {
  it('20. produces identical output across repeated calls', () => {
    const decisions = [
      decision('d1'),
      decision('bad', { decisionId: '' }),
      supersedingDecision('d3', 'd1'),
      decision('d2'),
    ];
    const run = () => {
      const result = appendRosterImportIdentityReviewDecisions(
        createEmptyRosterImportIdentityReviewDecisionRepositoryState(),
        decisions
      );
      return {
        all: getRosterImportIdentityReviewDecisions(result.state).map(
          (d) => d.decisionId
        ),
        active: getActiveRosterImportIdentityReviewDecisions(result.state).map(
          (d) => d.decisionId
        ),
        rejected: result.rejected.map((r) => r.reason),
      };
    };
    expect(run()).toEqual(run());
  });
});
