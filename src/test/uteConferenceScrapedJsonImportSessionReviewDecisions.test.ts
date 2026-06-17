import { describe, it, expect } from 'vitest';
import {
  createEmptyUteScrapedJsonImportSession,
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
  clearUteScrapedJsonImportSessionTarget,
  getUteScrapedJsonImportSessionSelectableTargets,
} from '../engine/uteConferenceScrapedJsonImportSession';
import {
  addUteScrapedJsonImportSessionReviewDecision,
  setUteScrapedJsonImportSessionReviewDecisions,
  clearUteScrapedJsonImportSessionReviewDecisions,
  getUteScrapedJsonImportSessionReviewDecisions,
  summarizeUteScrapedJsonImportSessionReviewState,
  mapUteScrapedJsonImportSessionReviewAction,
  uteScrapedJsonImportSessionReviewActionMutatesRoster,
  type UteScrapedJsonImportSessionReviewDecision,
  type UteScrapedJsonImportSessionReviewDecisionAction,
} from '../engine/uteConferenceScrapedJsonImportSessionReviewDecisions';

import playersPw from './fixtures/ute-scraped-json/players-2023-pw-small.json';

function firstSelectableId(session: ReturnType<typeof createUteScrapedJsonImportSessionFromPayload>) {
  return getUteScrapedJsonImportSessionSelectableTargets(session)[0].sourceTargetId;
}

function selectedPlayerSession() {
  const loaded = createUteScrapedJsonImportSessionFromPayload(playersPw);
  return selectUteScrapedJsonImportSessionTarget(loaded, firstSelectableId(loaded));
}

function firstDecision(
  session: ReturnType<typeof selectedPlayerSession>,
  action: UteScrapedJsonImportSessionReviewDecision['action'] = 'confirm-row-identity'
): UteScrapedJsonImportSessionReviewDecision {
  const row = session.selectedPlayerPreviewResult!.rows[0];
  return {
    sourceFingerprint: session.sourceFingerprint,
    sourceTargetId: session.selectedSourceTargetId!,
    sourceRowId: row.sourceRowId!,
    action,
    note: 'reviewed in session preview',
  };
}

function blockedPlayerPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'PW League 10',
      age_division_alias: 'PW',
      year: 2025,
      record_type: 'players',
      source_url: 'https://ute.example/blocked-review-decisions',
    },
    districts: [
      {
        district: 'Alta',
        league: 'PW League 10',
        teams_count: 1,
        teams: [
          {
            team_name: 'PeeWee C1',
            source_url: 'https://ute.example/alta/c1',
            players_count: 1,
            players: [{ name: '   ' }],
          },
        ],
      },
    ],
  };
}

describe('scraped JSON import session review decisions', () => {
  it('empty session cannot accept decisions', () => {
    const empty = createEmptyUteScrapedJsonImportSession();
    const next = setUteScrapedJsonImportSessionReviewDecisions(empty, [
      {
        sourceFingerprint: 'none',
        sourceTargetId: 'none',
        sourceRowId: 'row-1',
        action: 'confirm-row-identity',
      },
    ]);

    expect(next.selectedReviewDecisions).toEqual([]);
    expect(next.selectedReviewState.rejectedDecisionCount).toBe(1);
    expect(next.selectedReviewState.rejectedDecisions[0].reason).toBe('empty-session');
  });

  it('source-loaded but unselected session cannot accept target decisions', () => {
    const loaded = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const next = setUteScrapedJsonImportSessionReviewDecisions(loaded, [
      {
        sourceFingerprint: loaded.sourceFingerprint,
        sourceTargetId: 'scraped:missing',
        sourceRowId: 'row-1',
        action: 'confirm-row-identity',
      },
    ]);

    expect(next.selectedReviewDecisions).toEqual([]);
    expect(next.selectedReviewState.rejectedDecisionCount).toBe(1);
    expect(next.selectedReviewState.rejectedDecisions[0].reason).toBe('no-selected-target');
  });

  it('selected target can hold decisions', () => {
    const selected = selectedPlayerSession();
    const decision = firstDecision(selected);
    const next = setUteScrapedJsonImportSessionReviewDecisions(selected, [decision]);

    expect(getUteScrapedJsonImportSessionReviewDecisions(next)).toEqual([decision]);
    expect(next.selectedReviewState.acceptedDecisionCount).toBe(1);
  });

  it('decisions are reflected deterministically in preview review state', () => {
    const selected = selectedPlayerSession();
    const decision = firstDecision(selected, 'mark-row-needs-review');
    const a = setUteScrapedJsonImportSessionReviewDecisions(selected, [decision]);
    const b = setUteScrapedJsonImportSessionReviewDecisions(selected, [decision]);

    expect(summarizeUteScrapedJsonImportSessionReviewState(a)).toEqual(
      summarizeUteScrapedJsonImportSessionReviewState(b)
    );
    expect(a.selectedReviewState.rowStates[0].decisionAction).toBe('mark-row-needs-review');
    expect(a.selectedReviewState.rowStates[0].reviewStatus).toBe('needs-review');
  });

  it('decisions are cleared or isolated when target selection changes', () => {
    const selected = selectedPlayerSession();
    const withDecision = setUteScrapedJsonImportSessionReviewDecisions(selected, [
      firstDecision(selected),
    ]);
    const cleared = clearUteScrapedJsonImportSessionTarget(withDecision);
    const clearedReview = clearUteScrapedJsonImportSessionReviewDecisions(cleared);

    expect(cleared.selectedTarget).toBeNull();
    expect(clearedReview.selectedReviewDecisions).toEqual([]);
    expect(clearedReview.selectedReviewState.rowStates).toEqual([]);

    const loaded = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const ids = getUteScrapedJsonImportSessionSelectableTargets(loaded).map(
      (target) => target.sourceTargetId
    );
    const otherTarget = selectUteScrapedJsonImportSessionTarget(loaded, ids[1]);
    const isolated = setUteScrapedJsonImportSessionReviewDecisions(otherTarget, [
      firstDecision(selected),
    ]);

    expect(isolated.selectedReviewDecisions).toEqual([]);
    expect(isolated.selectedReviewState.rejectedDecisions[0].reason).toBe('target-mismatch');
  });

  it('invalid or mismatched target/source decisions are reported deterministically', () => {
    const selected = selectedPlayerSession();
    const valid = firstDecision(selected);
    const next = setUteScrapedJsonImportSessionReviewDecisions(
      selected,
      [
        { ...valid, sourceFingerprint: 'ute-scraped-session-deadbeef' },
        { ...valid, sourceTargetId: 'scraped:wrong-target' },
        { ...valid, sourceRowId: '   ' },
        { ...valid, sourceRowId: 'missing-row' },
      ],
      { expectedSourceFingerprint: selected.sourceFingerprint }
    );

    expect(next.selectedReviewState.acceptedDecisionCount).toBe(0);
    expect(next.selectedReviewState.rejectedDecisions.map((item) => item.reason)).toEqual([
      'source-fingerprint-mismatch',
      'target-mismatch',
      'missing-source-row-id',
      'row-not-found',
    ]);
  });

  it('raw roster records are not mutated', () => {
    const before = JSON.stringify(playersPw);
    const selected = selectedPlayerSession();
    setUteScrapedJsonImportSessionReviewDecisions(selected, [firstDecision(selected)]);

    expect(JSON.stringify(playersPw)).toBe(before);
    expect(selected.selectedPlayerPreviewResult?.rows[0].playerName).toBe('Cary, Hudson');
  });

  it('reapplying the same decision is idempotent', () => {
    const selected = selectedPlayerSession();
    const decision = firstDecision(selected);
    const once = addUteScrapedJsonImportSessionReviewDecision(selected, decision);
    const twice = addUteScrapedJsonImportSessionReviewDecision(once, decision);

    expect(twice).toEqual(once);
    expect(twice.selectedReviewState.acceptedDecisionCount).toBe(1);
  });

  it('blocked or empty targets do not become import-ready because decisions exist', () => {
    const blockedSession = createUteScrapedJsonImportSessionFromPayload(blockedPlayerPayload());
    const blockedTarget = blockedSession.readinessReport!.targets[0];
    const blocked = selectUteScrapedJsonImportSessionTarget(
      blockedSession,
      blockedTarget.sourceTargetId
    );
    const withDecision = setUteScrapedJsonImportSessionReviewDecisions(blocked, [
      {
        sourceFingerprint: blocked.sourceFingerprint,
        sourceTargetId: blockedTarget.sourceTargetId,
        sourceRowId: 'row-1',
        action: 'confirm-row-identity',
      },
    ]);

    expect(withDecision.status).toBe('target-blocked');
    expect(withDecision.summary.canProceedToPreview).toBe(false);
    expect(withDecision.selectedReviewState.acceptedDecisionCount).toBe(0);
  });
});

const ALL_ACTIONS: UteScrapedJsonImportSessionReviewDecisionAction[] = [
  'confirm-row-identity',
  'mark-row-needs-review',
  'ignore-row-for-review',
];

describe('canonical identity-review vocabulary adapter (composition)', () => {
  it('every session action maps to a review-only canonical effect, never a mutating one', () => {
    const reviewOnlyEffects = new Set(['no-effect', 'defer-review']);
    for (const action of ALL_ACTIONS) {
      const mapping = mapUteScrapedJsonImportSessionReviewAction(action);
      expect(reviewOnlyEffects.has(mapping.identityReviewEffect)).toBe(true);
      expect(uteScrapedJsonImportSessionReviewActionMutatesRoster(action)).toBe(false);
    }
  });

  it('only mark-row-needs-review binds to a canonical action (defer)', () => {
    expect(mapUteScrapedJsonImportSessionReviewAction('mark-row-needs-review')).toEqual({
      sessionAction: 'mark-row-needs-review',
      identityReviewAction: 'defer',
      identityReviewEffect: 'defer-review',
    });
    expect(
      mapUteScrapedJsonImportSessionReviewAction('confirm-row-identity').identityReviewAction
    ).toBeNull();
    expect(
      mapUteScrapedJsonImportSessionReviewAction('ignore-row-for-review').identityReviewAction
    ).toBeNull();
  });

  it('accepted decisions carry the canonical review-only effect on their row state', () => {
    const selected = selectedPlayerSession();
    const next = setUteScrapedJsonImportSessionReviewDecisions(selected, [
      firstDecision(selected, 'ignore-row-for-review'),
    ]);
    const row = next.selectedReviewState.rowStates.find(
      (state) => state.decisionAction === 'ignore-row-for-review'
    );
    expect(row?.identityReviewEffect).toBe('no-effect');
  });
});

describe('decisions affect review metadata only', () => {
  it('holding decisions does not change the slice 14 summary, readiness, or preview rows', () => {
    const selected = selectedPlayerSession();
    const next = setUteScrapedJsonImportSessionReviewDecisions(selected, [
      firstDecision(selected, 'mark-row-needs-review'),
    ]);

    // slice 14 selection / readiness / preview are untouched by review metadata.
    expect(next.status).toBe(selected.status);
    expect(next.summary).toEqual(selected.summary);
    expect(next.readinessReport).toBe(selected.readinessReport);
    expect(next.selectedPlayerPreviewResult).toBe(selected.selectedPlayerPreviewResult);
    // The review state is additive metadata; the source row order is preserved.
    expect(next.selectedReviewState.rowStates.map((state) => state.rowIndex)).toEqual(
      selected.selectedPlayerPreviewResult!.rows.map((row) => row.rowIndex)
    );
  });
});

describe('target switch cannot leak prior-target decisions without an explicit clear', () => {
  it('decisions carried onto a different selected target are auto-isolated on read', () => {
    const loaded = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const ids = getUteScrapedJsonImportSessionSelectableTargets(loaded).map(
      (target) => target.sourceTargetId
    );
    const targetA = selectUteScrapedJsonImportSessionTarget(loaded, ids[0]);
    const targetB = selectUteScrapedJsonImportSessionTarget(loaded, ids[1]);

    const withDecisionsA = setUteScrapedJsonImportSessionReviewDecisions(targetA, [
      firstDecision(targetA),
    ]);
    expect(getUteScrapedJsonImportSessionReviewDecisions(withDecisionsA)).toHaveLength(1);

    // Simulate a caller carrying target A's decisions onto target B WITHOUT clearing.
    const leaked = {
      ...targetB,
      selectedReviewDecisions: withDecisionsA.selectedReviewDecisions,
      selectedReviewState: withDecisionsA.selectedReviewState,
    };

    // Reads are re-validated against the current selection, so nothing leaks.
    expect(getUteScrapedJsonImportSessionReviewDecisions(leaked)).toEqual([]);
    const summary = summarizeUteScrapedJsonImportSessionReviewState(leaked);
    expect(summary.acceptedDecisionCount).toBe(0);
    expect(summary.sourceTargetId).toBe(ids[1]);
  });

  it('slice 14 target switch drops the decision-bearing fields entirely', () => {
    const loaded = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const ids = getUteScrapedJsonImportSessionSelectableTargets(loaded).map(
      (target) => target.sourceTargetId
    );
    const targetA = selectUteScrapedJsonImportSessionTarget(loaded, ids[0]);
    const withDecisionsA = setUteScrapedJsonImportSessionReviewDecisions(targetA, [
      firstDecision(targetA),
    ]);

    const switched = selectUteScrapedJsonImportSessionTarget(withDecisionsA, ids[1]);
    expect('selectedReviewDecisions' in switched).toBe(false);
    expect(getUteScrapedJsonImportSessionReviewDecisions(switched)).toEqual([]);
  });
});
