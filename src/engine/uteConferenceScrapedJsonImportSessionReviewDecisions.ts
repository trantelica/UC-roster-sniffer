import type { RosterImportPreviewRow } from './rosterImportPreview';
import type {
  UteScrapedJsonImportSession,
  UteScrapedJsonImportSessionIssue,
  UteScrapedJsonImportSessionIssueSeverity,
} from './uteConferenceScrapedJsonImportSession';

/**
 * Phase 5 slice 15: identity-review decisions held inside a scraped JSON import
 * session preview state, engine-only.
 *
 * This module does not import, commit, mutate rosters, persist, upload, fetch, or
 * introduce UI. It stores target-scoped decision metadata alongside an existing
 * slice 14 session snapshot and reflects those decisions into deterministic review
 * metadata. Source payloads and preview rows are never mutated.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_IMPORT_SESSION_REVIEW_DECISION_LOGIC_VERSION =
  'phase5-slice15-import-session-review-decision-state-v1';

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

export type UteScrapedJsonImportSessionReviewRowState = {
  sourceRowId: string;
  rowIndex: number;
  playerName: string | null;
  normalizedIdentityKey: string | null;
  previewStatus: RosterImportPreviewRow['status'];
  decisionAction: UteScrapedJsonImportSessionReviewDecisionAction | null;
  decisionNote: string | null;
  reviewStatus: 'unreviewed' | 'confirmed' | 'needs-review' | 'ignored-for-review';
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

function baseReviewState(
  session: UteScrapedJsonImportSession,
  accepted: UteScrapedJsonImportSessionReviewDecision[],
  rejected: UteScrapedJsonImportSessionRejectedReviewDecision[],
  issues: UteScrapedJsonImportSessionIssue[]
): UteScrapedJsonImportSessionReviewState {
  const decisionsBySourceRowId = new Map(
    accepted.map((decision) => [decision.sourceRowId, decision])
  );

  const rowStates = getPreviewRows(session)
    .filter((row) => row.sourceRowId !== null)
    .map((row) => {
      const decision = decisionsBySourceRowId.get(row.sourceRowId!);
      const reviewStatus: UteScrapedJsonImportSessionReviewRowState['reviewStatus'] =
        decision?.action === 'confirm-row-identity'
          ? 'confirmed'
          : decision?.action === 'mark-row-needs-review'
            ? 'needs-review'
            : decision?.action === 'ignore-row-for-review'
              ? 'ignored-for-review'
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
      };
    });

  const reviewedRowCount = rowStates.filter(
    (row) => row.reviewStatus !== 'unreviewed'
  ).length;

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
  return baseReviewState(session, [], [], issues);
}

function withReviewState(
  session: UteScrapedJsonImportSession,
  accepted: UteScrapedJsonImportSessionReviewDecision[],
  rejected: UteScrapedJsonImportSessionRejectedReviewDecision[],
  issues: UteScrapedJsonImportSessionIssue[]
): UteScrapedJsonImportSessionWithReviewDecisions {
  const selectedReviewDecisions = accepted.map((decision) => ({ ...decision }));
  return {
    ...session,
    selectedReviewDecisions,
    selectedReviewState: baseReviewState(session, selectedReviewDecisions, rejected, issues),
  };
}

function validateSessionForDecisions(
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
  return decisions.map((decision) => ({ decision: { ...decision }, reason }));
}

function normalizeDecisions(
  session: UteScrapedJsonImportSession,
  decisions: UteScrapedJsonImportSessionReviewDecision[],
  sessionIssues: UteScrapedJsonImportSessionIssue[]
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
  if (sessionIssues.some((item) => item.code === 'source-fingerprint-mismatch')) {
    return { accepted: [], rejected: rejectAll(decisions, 'source-fingerprint-mismatch') };
  }
  if (sessionIssues.some((item) => item.code === 'target-not-found')) {
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
      rejected.push({ decision: { ...decision }, reason: 'source-fingerprint-mismatch' });
      continue;
    }
    if (decision.sourceTargetId !== session.selectedSourceTargetId) {
      rejected.push({ decision: { ...decision }, reason: 'target-mismatch' });
      continue;
    }
    if (decision.sourceRowId.trim() === '') {
      rejected.push({ decision: { ...decision }, reason: 'missing-source-row-id' });
      continue;
    }
    if (!rowIds.has(decision.sourceRowId)) {
      rejected.push({ decision: { ...decision }, reason: 'row-not-found' });
      continue;
    }
    acceptedByRowId.set(decision.sourceRowId, { ...decision });
  }

  return {
    accepted: [...acceptedByRowId.values()].sort((a, b) =>
      a.sourceRowId.localeCompare(b.sourceRowId)
    ),
    rejected,
  };
}

export function setUteScrapedJsonImportSessionReviewDecisions(
  session: UteScrapedJsonImportSession,
  decisions: UteScrapedJsonImportSessionReviewDecision[],
  options?: UteScrapedJsonImportSessionReviewDecisionOptions
): UteScrapedJsonImportSessionWithReviewDecisions {
  const sessionIssues = validateSessionForDecisions(session, options);
  const { accepted, rejected } = normalizeDecisions(session, decisions, sessionIssues);
  return withReviewState(session, accepted, rejected, sessionIssues);
}

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

export function clearUteScrapedJsonImportSessionReviewDecisions(
  session: UteScrapedJsonImportSession
): UteScrapedJsonImportSessionWithReviewDecisions {
  return {
    ...session,
    selectedReviewDecisions: [],
    selectedReviewState: emptyReviewState(session),
  };
}

export function getUteScrapedJsonImportSessionReviewDecisions(
  session: UteScrapedJsonImportSession | Partial<UteScrapedJsonImportSessionWithReviewDecisions>
): UteScrapedJsonImportSessionReviewDecision[] {
  if ('selectedReviewDecisions' in session && session.selectedReviewDecisions) {
    return session.selectedReviewDecisions.map((decision) => ({ ...decision }));
  }
  return [];
}

export function summarizeUteScrapedJsonImportSessionReviewState(
  session: UteScrapedJsonImportSession | Partial<UteScrapedJsonImportSessionWithReviewDecisions>
): UteScrapedJsonImportSessionReviewState {
  if ('selectedReviewState' in session && session.selectedReviewState) {
    return {
      ...session.selectedReviewState,
      rowStates: [...session.selectedReviewState.rowStates],
      rejectedDecisions: [...session.selectedReviewState.rejectedDecisions],
      issues: [...session.selectedReviewState.issues],
    };
  }

  return emptyReviewState(session as UteScrapedJsonImportSession);
}
