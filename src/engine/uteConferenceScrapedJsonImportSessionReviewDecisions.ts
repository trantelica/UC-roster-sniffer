import type { RosterImportPreviewRow } from './rosterImportPreview';
import type {
  RosterImportIdentityReviewActionType,
  RosterImportIdentityReviewActionEffect,
} from './rosterImportIdentityReviewDecision';
import type {
  UteScrapedJsonImportSession,
  UteScrapedJsonImportSessionIssue,
  UteScrapedJsonImportSessionIssueSeverity,
} from './uteConferenceScrapedJsonImportSession';

/**
 * Phase 5 slice 15: SESSION-LEVEL review-decision state for a scraped JSON import
 * session — ENGINE ONLY.
 *
 * This layer answers: "can the slice 14 session hold reviewer decisions for the rows
 * of the currently selected scraped JSON target, and expose deterministic review
 * metadata that reflects those decisions, before anything is applied or committed?"
 *
 * Relationship to the slice 2–5 identity-review stack
 * ---------------------------------------------------
 * The canonical import identity-review helpers
 * (`applyRosterImportIdentityReviewAction`, `createRosterImportIdentityReviewDecision`,
 * the decision repository, and the decision application module) operate on identity
 * MATCH ENTRIES (`RosterImportPreviewIdentityMatchEntry`). Those entries only exist
 * once preview rows have been matched against an existing-roster registry
 * (`ExistingRosterIdentityRecord[]`). The scraped JSON session (slices 10–14) has no
 * existing-roster registry wired in and computes no match entries — it carries slice 1
 * preview rows only. So the canonical decision/repository/application helpers do not
 * fit this layer yet and are intentionally NOT invoked here (see
 * `docs/derived-logic.md`, "Scraped JSON import session review decisions").
 *
 * To avoid drifting into a parallel decision model, this layer does NOT define its own
 * apply semantics. Instead, every session review action is bound to the canonical
 * identity-review vocabulary through `mapUteScrapedJsonImportSessionReviewAction`,
 * which projects each action onto a canonical effect. Every session action maps to a
 * REVIEW-ONLY effect (`no-effect` or `defer-review`) and never to a roster-mutating
 * effect (`link-to-existing`, `create-new-roster-entry`, `reject-import-row`). This is
 * how the slice guarantees, by construction, that holding decisions can never apply,
 * commit, mutate, suppress, or reorder source data.
 *
 * This module does not import/commit, persist, upload, fetch, mutate rosters, derive
 * movement, compute coach analytics, or introduce UI. Source payloads, preview rows,
 * raw names, source URLs, and source order are never mutated. Review state is always
 * re-derived against the CURRENT session, so a decision can only ever surface for the
 * target and source fingerprint it was made against.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_IMPORT_SESSION_REVIEW_DECISION_LOGIC_VERSION =
  'phase5-slice15-import-session-review-decision-state-v2';

export type UteScrapedJsonImportSessionReviewDecisionAction =
  | 'confirm-row-identity'
  | 'mark-row-needs-review'
  | 'ignore-row-for-review';

export type UteScrapedJsonImportSessionReviewDecision = {
  sourceFingerprint: string;
  sourceTargetId: string;
  sourceRowId: string;
  action: UteScrapedJsonImportSessionReviewDecisionAction;
  note?: string;
};

export type UteScrapedJsonImportSessionReviewDecisionRejectionReason =
  | 'empty-session'
  | 'no-selected-target'
  | 'source-fingerprint-mismatch'
  | 'target-mismatch'
  | 'missing-source-row-id'
  | 'row-not-found';

export type UteScrapedJsonImportSessionRejectedReviewDecision = {
  decision: UteScrapedJsonImportSessionReviewDecision;
  reason: UteScrapedJsonImportSessionReviewDecisionRejectionReason;
};

export type UteScrapedJsonImportSessionReviewRowStatus =
  | 'unreviewed'
  | 'confirmed'
  | 'needs-review'
  | 'ignored-for-review';

export type UteScrapedJsonImportSessionReviewRowState = {
  sourceRowId: string;
  rowIndex: number;
  playerName: string | null;
  normalizedIdentityKey: string | null;
  previewStatus: RosterImportPreviewRow['status'];
  decisionAction: UteScrapedJsonImportSessionReviewDecisionAction | null;
  decisionNote: string | null;
  reviewStatus: UteScrapedJsonImportSessionReviewRowStatus;
  /**
   * The canonical identity-review effect this decision projects onto (always a
   * review-only effect). Null when the row has no decision.
   */
  identityReviewEffect: RosterImportIdentityReviewActionEffect | null;
};

export type UteScrapedJsonImportSessionReviewState = {
  sourceFingerprint: string;
  sourceTargetId: string | null;
  selectedTargetStatus: UteScrapedJsonImportSession['status'];
  acceptedDecisionCount: number;
  rejectedDecisionCount: number;
  reviewedRowCount: number;
  unreviewedRowCount: number;
  confirmedRowCount: number;
  needsReviewRowCount: number;
  ignoredForReviewRowCount: number;
  rowStates: UteScrapedJsonImportSessionReviewRowState[];
  rejectedDecisions: UteScrapedJsonImportSessionRejectedReviewDecision[];
  issues: UteScrapedJsonImportSessionIssue[];
};

export type UteScrapedJsonImportSessionWithReviewDecisions =
  UteScrapedJsonImportSession & {
    selectedReviewDecisions: UteScrapedJsonImportSessionReviewDecision[];
    selectedReviewState: UteScrapedJsonImportSessionReviewState;
  };

export type UteScrapedJsonImportSessionReviewDecisionOptions = {
  expectedSourceFingerprint?: string;
  expectedSourceTargetId?: string;
};

// ---------------------------------------------------------------------------
// Canonical identity-review vocabulary adapter
// ---------------------------------------------------------------------------

/**
 * Maps one session review action onto the canonical identity-review vocabulary.
 *
 * Only `mark-row-needs-review` corresponds to a canonical ACTION (`defer`); the other
 * two session actions are review-layer annotations that have no candidate-matching
 * counterpart (there are no match entries at this layer), so their canonical action is
 * null. Every session action projects to a REVIEW-ONLY effect — never a roster-mutating
 * one — which is what keeps this layer apply/commit-free by construction.
 */
export type UteScrapedJsonImportSessionReviewActionMapping = {
  sessionAction: UteScrapedJsonImportSessionReviewDecisionAction;
  identityReviewAction: RosterImportIdentityReviewActionType | null;
  identityReviewEffect: RosterImportIdentityReviewActionEffect;
};

const REVIEW_ACTION_MAPPING: Record<
  UteScrapedJsonImportSessionReviewDecisionAction,
  UteScrapedJsonImportSessionReviewActionMapping
> = {
  'confirm-row-identity': {
    sessionAction: 'confirm-row-identity',
    identityReviewAction: null,
    identityReviewEffect: 'no-effect',
  },
  'mark-row-needs-review': {
    sessionAction: 'mark-row-needs-review',
    identityReviewAction: 'defer',
    identityReviewEffect: 'defer-review',
  },
  'ignore-row-for-review': {
    sessionAction: 'ignore-row-for-review',
    identityReviewAction: null,
    identityReviewEffect: 'no-effect',
  },
};

/** The set of canonical effects that would alter roster/source data. */
const ROSTER_MUTATING_EFFECTS: ReadonlySet<RosterImportIdentityReviewActionEffect> =
  new Set(['link-to-existing', 'create-new-roster-entry', 'reject-import-row']);

/** Projects a session review action onto the canonical identity-review vocabulary. */
export function mapUteScrapedJsonImportSessionReviewAction(
  action: UteScrapedJsonImportSessionReviewDecisionAction
): UteScrapedJsonImportSessionReviewActionMapping {
  return REVIEW_ACTION_MAPPING[action];
}

/**
 * True when a session review action could ever alter, remove, or suppress source data.
 * Always false by construction — exposed so callers/tests can assert the guardrail.
 */
export function uteScrapedJsonImportSessionReviewActionMutatesRoster(
  action: UteScrapedJsonImportSessionReviewDecisionAction
): boolean {
  return ROSTER_MUTATING_EFFECTS.has(mapUteScrapedJsonImportSessionReviewAction(action).identityReviewEffect);
}

const REVIEW_STATUS_BY_ACTION: Record<
  UteScrapedJsonImportSessionReviewDecisionAction,
  UteScrapedJsonImportSessionReviewRowStatus
> = {
  'confirm-row-identity': 'confirmed',
  'mark-row-needs-review': 'needs-review',
  'ignore-row-for-review': 'ignored-for-review',
};

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function issue(
  code: UteScrapedJsonImportSessionIssue['code'],
  severity: UteScrapedJsonImportSessionIssueSeverity,
  message: string
): UteScrapedJsonImportSessionIssue {
  return { code, severity, message };
}

function presentString(value: string | undefined): string | null {
  return value === undefined || value.trim() === '' ? null : value;
}

function getPreviewRows(session: UteScrapedJsonImportSession): RosterImportPreviewRow[] {
  return session.selectedPlayerPreviewResult?.rows ?? [];
}

function cloneDecision(
  decision: UteScrapedJsonImportSessionReviewDecision
): UteScrapedJsonImportSessionReviewDecision {
  return { ...decision };
}

/** Reads the stored raw decisions off a session, if any, without re-validation. */
function readStoredDecisions(
  session:
    | UteScrapedJsonImportSession
    | Partial<UteScrapedJsonImportSessionWithReviewDecisions>
): UteScrapedJsonImportSessionReviewDecision[] {
  if ('selectedReviewDecisions' in session && session.selectedReviewDecisions) {
    return session.selectedReviewDecisions;
  }
  return [];
}

// ---------------------------------------------------------------------------
// Gate + per-decision validation (re-run against the CURRENT session)
// ---------------------------------------------------------------------------

function sessionGateIssues(
  session: UteScrapedJsonImportSession,
  options?: UteScrapedJsonImportSessionReviewDecisionOptions
): UteScrapedJsonImportSessionIssue[] {
  const issues: UteScrapedJsonImportSessionIssue[] = [];

  if (!session.readinessReport || session.status === 'uninitialized') {
    issues.push(
      issue('invalid-source', 'error', 'No scraped JSON source is loaded for review decisions.')
    );
  }
  if (!session.selectedTarget || !session.selectedSourceTargetId) {
    issues.push(
      issue('target-not-found', 'error', 'No selected import target exists for review decisions.')
    );
  }
  if (
    options?.expectedSourceFingerprint !== undefined &&
    options.expectedSourceFingerprint !== session.sourceFingerprint
  ) {
    issues.push(
      issue(
        'source-fingerprint-mismatch',
        'error',
        'The expected source fingerprint does not match this session.'
      )
    );
  }
  if (
    options?.expectedSourceTargetId !== undefined &&
    options.expectedSourceTargetId !== session.selectedSourceTargetId
  ) {
    issues.push(
      issue('target-not-found', 'error', 'The expected target does not match this session.')
    );
  }

  return issues;
}

function rejectAll(
  decisions: UteScrapedJsonImportSessionReviewDecision[],
  reason: UteScrapedJsonImportSessionReviewDecisionRejectionReason
): UteScrapedJsonImportSessionRejectedReviewDecision[] {
  return decisions.map((decision) => ({ decision: cloneDecision(decision), reason }));
}

/**
 * Partitions decisions into accepted/rejected against the CURRENT session. This is the
 * single isolation choke point: a decision is accepted only when the session has a
 * selected target, the gate issues are clear, and the decision's own fingerprint,
 * target id, and row id all match the currently selected target's preview rows. Run on
 * every set AND every read, so stale decisions can never carry forward.
 */
function partitionDecisions(
  session: UteScrapedJsonImportSession,
  decisions: UteScrapedJsonImportSessionReviewDecision[],
  gateIssues: UteScrapedJsonImportSessionIssue[]
): {
  accepted: UteScrapedJsonImportSessionReviewDecision[];
  rejected: UteScrapedJsonImportSessionRejectedReviewDecision[];
} {
  if (!session.readinessReport || session.status === 'uninitialized') {
    return { accepted: [], rejected: rejectAll(decisions, 'empty-session') };
  }
  if (!session.selectedTarget || !session.selectedSourceTargetId) {
    return { accepted: [], rejected: rejectAll(decisions, 'no-selected-target') };
  }
  if (gateIssues.some((item) => item.code === 'source-fingerprint-mismatch')) {
    return { accepted: [], rejected: rejectAll(decisions, 'source-fingerprint-mismatch') };
  }
  if (gateIssues.some((item) => item.code === 'target-not-found')) {
    return { accepted: [], rejected: rejectAll(decisions, 'target-mismatch') };
  }

  const rowIds = new Set(
    getPreviewRows(session)
      .map((row) => row.sourceRowId)
      .filter((sourceRowId): sourceRowId is string => sourceRowId !== null)
  );
  const acceptedByRowId = new Map<string, UteScrapedJsonImportSessionReviewDecision>();
  const rejected: UteScrapedJsonImportSessionRejectedReviewDecision[] = [];

  for (const decision of decisions) {
    if (decision.sourceFingerprint !== session.sourceFingerprint) {
      rejected.push({ decision: cloneDecision(decision), reason: 'source-fingerprint-mismatch' });
      continue;
    }
    if (decision.sourceTargetId !== session.selectedSourceTargetId) {
      rejected.push({ decision: cloneDecision(decision), reason: 'target-mismatch' });
      continue;
    }
    if (decision.sourceRowId.trim() === '') {
      rejected.push({ decision: cloneDecision(decision), reason: 'missing-source-row-id' });
      continue;
    }
    if (!rowIds.has(decision.sourceRowId)) {
      rejected.push({ decision: cloneDecision(decision), reason: 'row-not-found' });
      continue;
    }
    // Last write wins per row; idempotent for an unchanged decision.
    acceptedByRowId.set(decision.sourceRowId, cloneDecision(decision));
  }

  // Order accepted decisions by their preview-row (source) order for determinism.
  const orderByRowId = new Map<string, number>();
  getPreviewRows(session).forEach((row) => {
    if (row.sourceRowId !== null && !orderByRowId.has(row.sourceRowId)) {
      orderByRowId.set(row.sourceRowId, row.rowIndex);
    }
  });
  const accepted = [...acceptedByRowId.values()].sort(
    (a, b) =>
      (orderByRowId.get(a.sourceRowId) ?? 0) - (orderByRowId.get(b.sourceRowId) ?? 0)
  );

  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// Review-state derivation (pure; never mutates preview rows or the payload)
// ---------------------------------------------------------------------------

function deriveReviewState(
  session: UteScrapedJsonImportSession,
  accepted: UteScrapedJsonImportSessionReviewDecision[],
  rejected: UteScrapedJsonImportSessionRejectedReviewDecision[],
  issues: UteScrapedJsonImportSessionIssue[]
): UteScrapedJsonImportSessionReviewState {
  const decisionsBySourceRowId = new Map(
    accepted.map((decision) => [decision.sourceRowId, decision])
  );

  const rowStates: UteScrapedJsonImportSessionReviewRowState[] = getPreviewRows(session)
    .filter((row) => row.sourceRowId !== null)
    .map((row) => {
      const decision = decisionsBySourceRowId.get(row.sourceRowId!);
      const reviewStatus = decision
        ? REVIEW_STATUS_BY_ACTION[decision.action]
        : 'unreviewed';
      return {
        sourceRowId: row.sourceRowId!,
        rowIndex: row.rowIndex,
        playerName: row.playerName,
        normalizedIdentityKey: row.normalizedIdentityKey,
        previewStatus: row.status,
        decisionAction: decision?.action ?? null,
        decisionNote: presentString(decision?.note) ?? null,
        reviewStatus,
        identityReviewEffect: decision
          ? mapUteScrapedJsonImportSessionReviewAction(decision.action).identityReviewEffect
          : null,
      };
    });

  const reviewedRowCount = rowStates.filter((row) => row.reviewStatus !== 'unreviewed').length;

  return {
    sourceFingerprint: session.sourceFingerprint,
    sourceTargetId: session.selectedSourceTargetId,
    selectedTargetStatus: session.status,
    acceptedDecisionCount: accepted.length,
    rejectedDecisionCount: rejected.length,
    reviewedRowCount,
    unreviewedRowCount: rowStates.length - reviewedRowCount,
    confirmedRowCount: rowStates.filter((row) => row.reviewStatus === 'confirmed').length,
    needsReviewRowCount: rowStates.filter((row) => row.reviewStatus === 'needs-review').length,
    ignoredForReviewRowCount: rowStates.filter(
      (row) => row.reviewStatus === 'ignored-for-review'
    ).length,
    rowStates,
    rejectedDecisions: rejected,
    issues,
  };
}

function emptyReviewState(
  session: UteScrapedJsonImportSession,
  issues: UteScrapedJsonImportSessionIssue[] = []
): UteScrapedJsonImportSessionReviewState {
  return deriveReviewState(session, [], [], issues);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Replaces the session's review decisions with `decisions`, accepting only those valid
 * for the currently selected target. Returns a NEW session-with-decisions; the input
 * session, its payload, and its preview rows are never mutated.
 */
export function setUteScrapedJsonImportSessionReviewDecisions(
  session: UteScrapedJsonImportSession,
  decisions: UteScrapedJsonImportSessionReviewDecision[],
  options?: UteScrapedJsonImportSessionReviewDecisionOptions
): UteScrapedJsonImportSessionWithReviewDecisions {
  const gateIssues = sessionGateIssues(session, options);
  const { accepted, rejected } = partitionDecisions(session, decisions, gateIssues);
  return {
    ...session,
    selectedReviewDecisions: accepted.map(cloneDecision),
    selectedReviewState: deriveReviewState(session, accepted, rejected, gateIssues),
  };
}

/**
 * Adds (or replaces, per row) one review decision, preserving any prior decisions that
 * are still valid for the currently selected target. Idempotent for an unchanged
 * decision.
 */
export function addUteScrapedJsonImportSessionReviewDecision(
  session: UteScrapedJsonImportSession | UteScrapedJsonImportSessionWithReviewDecisions,
  decision: UteScrapedJsonImportSessionReviewDecision,
  options?: UteScrapedJsonImportSessionReviewDecisionOptions
): UteScrapedJsonImportSessionWithReviewDecisions {
  const prior = getUteScrapedJsonImportSessionReviewDecisions(session);
  const withoutSameRow = prior.filter(
    (existing) => existing.sourceRowId !== decision.sourceRowId
  );
  return setUteScrapedJsonImportSessionReviewDecisions(
    session,
    [...withoutSameRow, decision],
    options
  );
}

/** Clears all review decisions while preserving the loaded source and selection. */
export function clearUteScrapedJsonImportSessionReviewDecisions(
  session: UteScrapedJsonImportSession
): UteScrapedJsonImportSessionWithReviewDecisions {
  return {
    ...session,
    selectedReviewDecisions: [],
    selectedReviewState: emptyReviewState(session),
  };
}

/**
 * The review decisions that still apply to the CURRENT session. Stored decisions are
 * re-validated against the current selected target id, source fingerprint, and preview
 * rows, so decisions made for a previously selected target never leak forward — even if
 * a caller carries the decision-bearing session onto a different selection without
 * clearing first.
 */
export function getUteScrapedJsonImportSessionReviewDecisions(
  session: UteScrapedJsonImportSession | Partial<UteScrapedJsonImportSessionWithReviewDecisions>
): UteScrapedJsonImportSessionReviewDecision[] {
  const stored = readStoredDecisions(session);
  if (stored.length === 0) return [];
  const fullSession = session as UteScrapedJsonImportSession;
  const gateIssues = sessionGateIssues(fullSession);
  const { accepted } = partitionDecisions(fullSession, stored, gateIssues);
  return accepted.map(cloneDecision);
}

/**
 * The review state for the CURRENT session, re-derived from stored decisions that are
 * still valid for the current selection. A session without stored decisions yields the
 * empty review state for its current selection.
 */
export function summarizeUteScrapedJsonImportSessionReviewState(
  session: UteScrapedJsonImportSession | Partial<UteScrapedJsonImportSessionWithReviewDecisions>
): UteScrapedJsonImportSessionReviewState {
  const fullSession = session as UteScrapedJsonImportSession;
  const stored = readStoredDecisions(session);
  const gateIssues = sessionGateIssues(fullSession);
  const { accepted, rejected } = partitionDecisions(fullSession, stored, gateIssues);
  return deriveReviewState(fullSession, accepted, rejected, gateIssues);
}
