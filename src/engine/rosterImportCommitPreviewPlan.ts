import type {
  AppliedRosterImportIdentityReviewDecisionEntry,
  AppliedRosterImportIdentityReviewDecisionResult,
} from './rosterImportIdentityReviewDecisionApplication';

/**
 * Phase 5 slice 6: import commit preview / dry-run PLAN — ENGINE ONLY.
 *
 * Slice 5 (`applyRosterImportIdentityReviewDecisionsToMatches`) resolved each
 * import preview row to an effective outcome (link-to-existing / create-new /
 * rejected / deferred / unresolved / conflict / skipped-*). This slice folds those
 * applied entries into a deterministic DRY-RUN commit plan: per row, what the system
 * WOULD do on a future commit, and what BLOCKS the commit.
 *
 * This is COMMIT-PREVIEW PLANNING ONLY. It is NOT import apply/commit, NOT roster
 * mutation, NOT creating/linking roster records, NOT deleting/suppressing/rewriting/
 * merging/nullifying/reordering import rows or roster records, NOT persistence, NOT
 * file parsing, and NOT UI. A `ready-to-link` / `ready-to-create` row is a FUTURE
 * intended operation, never a write. It does not compare against prior seasons or
 * derive roster movement.
 *
 * Roster authority rule (carried forward): loaded roster records are authoritative.
 * This helper never alters, removes, suppresses, merges, nullifies, rewrites,
 * reorders, or ignores rostered names, existing records, preview rows, applied
 * entries, or candidates. Source applied entries are preserved by reference
 * (`originalAppliedEntry`); plan metadata is fresh.
 */

export type RosterImportCommitPreviewPlanStatus =
  | 'ready-to-link'
  | 'ready-to-create'
  | 'rejected'
  | 'deferred'
  | 'blocked-unresolved'
  | 'blocked-conflict'
  | 'blocked-invalid-preview-row'
  | 'blocked-review-preview-row';

export type RosterImportCommitPreviewPlanOperation =
  | 'link-existing-record'
  | 'create-new-roster-entry'
  | 'reject-import-row'
  | 'defer-review'
  | 'none';

export type RosterImportCommitPreviewPlanBlockerCode =
  | 'unresolved-identity'
  | 'conflicting-decisions'
  | 'invalid-preview-row'
  | 'preview-row-needs-review'
  | 'missing-target-existing-record-id'
  | 'invalid-target-context';

export type RosterImportCommitPreviewPlanReasonCode =
  | 'accepted-candidate-link'
  | 'manual-link'
  | 'reviewer-create-new'
  | 'reviewer-rejected'
  | 'reviewer-deferred'
  | 'no-review-decision'
  | 'skipped-invalid-preview-row'
  | 'skipped-review-preview-row'
  | 'conflict';

export type RosterImportCommitPreviewPlanRow = {
  previewSourceRowId: string | null;
  previewRowIndex: number;
  previewPlayerName: string | null;
  sourceEntryStatus: AppliedRosterImportIdentityReviewDecisionEntry['sourceEntryStatus'];
  effectiveOutcome: AppliedRosterImportIdentityReviewDecisionEntry['effectiveOutcome'];
  planStatus: RosterImportCommitPreviewPlanStatus;
  plannedOperation: RosterImportCommitPreviewPlanOperation;
  targetExistingRecordId: string | null;
  reasons: RosterImportCommitPreviewPlanReasonCode[];
  blockers: RosterImportCommitPreviewPlanBlockerCode[];
  originalAppliedEntry: AppliedRosterImportIdentityReviewDecisionEntry;
};

export type RosterImportCommitPreviewPlanTargetContext = {
  seasonId: string | null;
  districtId: string | null;
  ageDivisionId: string | null;
  teamId: string | null;
};

export type RosterImportCommitPreviewPlanInput = {
  appliedEntries?: AppliedRosterImportIdentityReviewDecisionEntry[];
  targetContext?: {
    seasonId?: string;
    districtId?: string;
    ageDivisionId?: string;
    teamId?: string;
  };
};

export type RosterImportCommitPreviewPlanSummary = {
  totalRows: number;
  readyToLinkRows: number;
  readyToCreateRows: number;
  rejectedRows: number;
  deferredRows: number;
  blockedUnresolvedRows: number;
  blockedConflictRows: number;
  blockedInvalidPreviewRows: number;
  blockedReviewPreviewRows: number;
  blockingRows: number;
  plannedLinkOperations: number;
  plannedCreateOperations: number;
  plannedRejectOperations: number;
  plannedDeferOperations: number;
  blockerCount: number;
  canCommit: boolean;
};

export type RosterImportCommitPreviewPlanResult = {
  canCommit: boolean;
  targetContext: RosterImportCommitPreviewPlanTargetContext;
  targetContextProvided: boolean;
  targetContextValid: boolean;
  rows: RosterImportCommitPreviewPlanRow[];
  /** Result-level blockers (e.g. invalid target context). Row blockers live on rows. */
  blockers: RosterImportCommitPreviewPlanBlockerCode[];
  summary: RosterImportCommitPreviewPlanSummary;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function presentOrNull(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}

function isBlockingStatus(status: RosterImportCommitPreviewPlanStatus): boolean {
  return status.startsWith('blocked-');
}

/**
 * Maps one applied entry to a plan row. Pure: reads only the entry's effective
 * outcome and link target; never mutates the entry. `originalAppliedEntry` is the
 * source entry by reference.
 */
function planRowForEntry(
  entry: AppliedRosterImportIdentityReviewDecisionEntry
): RosterImportCommitPreviewPlanRow {
  const base = {
    previewSourceRowId: entry.previewSourceRowId,
    previewRowIndex: entry.previewRowIndex,
    previewPlayerName: entry.previewPlayerName,
    sourceEntryStatus: entry.sourceEntryStatus,
    effectiveOutcome: entry.effectiveOutcome,
    originalAppliedEntry: entry,
  };

  const make = (
    planStatus: RosterImportCommitPreviewPlanStatus,
    plannedOperation: RosterImportCommitPreviewPlanOperation,
    reason: RosterImportCommitPreviewPlanReasonCode,
    blockers: RosterImportCommitPreviewPlanBlockerCode[] = [],
    targetExistingRecordId: string | null = null
  ): RosterImportCommitPreviewPlanRow => ({
    ...base,
    planStatus,
    plannedOperation,
    targetExistingRecordId,
    reasons: [reason],
    blockers,
  });

  switch (entry.effectiveOutcome) {
    case 'link-to-existing': {
      const selected = presentOrNull(entry.selectedExistingRecordId);
      const manual = presentOrNull(entry.manualExistingRecordId);
      const target = selected ?? manual;
      if (target === null) {
        // Anomalous: a link outcome with no usable target. Blocked, never linked.
        return make('blocked-unresolved', 'none', 'no-review-decision', [
          'missing-target-existing-record-id',
        ]);
      }
      return make(
        'ready-to-link',
        'link-existing-record',
        selected !== null ? 'accepted-candidate-link' : 'manual-link',
        [],
        target
      );
    }
    case 'create-new':
      return make(
        'ready-to-create',
        'create-new-roster-entry',
        'reviewer-create-new'
      );
    case 'rejected':
      return make('rejected', 'reject-import-row', 'reviewer-rejected');
    case 'deferred':
      return make('deferred', 'defer-review', 'reviewer-deferred');
    case 'unresolved':
      return make('blocked-unresolved', 'none', 'no-review-decision', [
        'unresolved-identity',
      ]);
    case 'conflict':
      return make('blocked-conflict', 'none', 'conflict', [
        'conflicting-decisions',
      ]);
    case 'skipped-invalid-preview-row':
      return make(
        'blocked-invalid-preview-row',
        'none',
        'skipped-invalid-preview-row',
        ['invalid-preview-row']
      );
    case 'skipped-review-preview-row':
      return make(
        'blocked-review-preview-row',
        'none',
        'skipped-review-preview-row',
        ['preview-row-needs-review']
      );
    default:
      // Defensive: an unknown outcome is conservatively blocked, never committed.
      return make('blocked-unresolved', 'none', 'no-review-decision', [
        'unresolved-identity',
      ]);
  }
}

/**
 * Builds a dry-run import commit preview plan from applied identity-review entries.
 * Pure and deterministic: exactly one plan row per applied entry (in input order).
 * Nothing is written, linked, created, or removed.
 *
 * Commit gating: `canCommit` is true only when there is at least one row, every row
 * is `ready-to-link` / `ready-to-create` / `rejected` / `deferred` (no `blocked-*`
 * rows), and any provided target context is complete. Rejected and deferred rows
 * are explicit reviewer outcomes and do NOT block the commit. Empty input yields a
 * deterministic empty plan with `canCommit: false` (nothing to commit).
 */
export function createRosterImportCommitPreviewPlan(
  input: RosterImportCommitPreviewPlanInput
): RosterImportCommitPreviewPlanResult {
  const appliedEntries = Array.isArray(input.appliedEntries)
    ? input.appliedEntries
    : [];

  const provided =
    input.targetContext != null && typeof input.targetContext === 'object';
  const targetContext: RosterImportCommitPreviewPlanTargetContext = {
    seasonId: provided ? presentOrNull(input.targetContext!.seasonId) : null,
    districtId: provided ? presentOrNull(input.targetContext!.districtId) : null,
    ageDivisionId: provided
      ? presentOrNull(input.targetContext!.ageDivisionId)
      : null,
    teamId: provided ? presentOrNull(input.targetContext!.teamId) : null,
  };
  const targetContextValid =
    !provided ||
    (targetContext.seasonId !== null &&
      targetContext.districtId !== null &&
      targetContext.ageDivisionId !== null &&
      targetContext.teamId !== null);

  const blockers: RosterImportCommitPreviewPlanBlockerCode[] = [];
  if (provided && !targetContextValid) {
    blockers.push('invalid-target-context');
  }

  const rows = appliedEntries.map(planRowForEntry);
  const summary = summarizeRosterImportCommitPreviewPlanRows(rows);

  const canCommit =
    summary.canCommit && targetContextValid && blockers.length === 0;

  return {
    canCommit,
    targetContext,
    targetContextProvided: provided,
    targetContextValid,
    rows,
    blockers,
    summary,
  };
}

/**
 * Tallies plan rows into deterministic counts. The reported `canCommit` is
 * ROW-LEVEL readiness (at least one row and no `blocked-*` rows); the result's
 * top-level `canCommit` additionally requires a valid target context.
 */
export function summarizeRosterImportCommitPreviewPlanRows(
  rows: RosterImportCommitPreviewPlanRow[]
): RosterImportCommitPreviewPlanSummary {
  const summary: RosterImportCommitPreviewPlanSummary = {
    totalRows: rows.length,
    readyToLinkRows: 0,
    readyToCreateRows: 0,
    rejectedRows: 0,
    deferredRows: 0,
    blockedUnresolvedRows: 0,
    blockedConflictRows: 0,
    blockedInvalidPreviewRows: 0,
    blockedReviewPreviewRows: 0,
    blockingRows: 0,
    plannedLinkOperations: 0,
    plannedCreateOperations: 0,
    plannedRejectOperations: 0,
    plannedDeferOperations: 0,
    blockerCount: 0,
    canCommit: false,
  };

  for (const row of rows) {
    switch (row.planStatus) {
      case 'ready-to-link':
        summary.readyToLinkRows += 1;
        break;
      case 'ready-to-create':
        summary.readyToCreateRows += 1;
        break;
      case 'rejected':
        summary.rejectedRows += 1;
        break;
      case 'deferred':
        summary.deferredRows += 1;
        break;
      case 'blocked-unresolved':
        summary.blockedUnresolvedRows += 1;
        break;
      case 'blocked-conflict':
        summary.blockedConflictRows += 1;
        break;
      case 'blocked-invalid-preview-row':
        summary.blockedInvalidPreviewRows += 1;
        break;
      case 'blocked-review-preview-row':
        summary.blockedReviewPreviewRows += 1;
        break;
    }

    if (isBlockingStatus(row.planStatus)) summary.blockingRows += 1;

    switch (row.plannedOperation) {
      case 'link-existing-record':
        summary.plannedLinkOperations += 1;
        break;
      case 'create-new-roster-entry':
        summary.plannedCreateOperations += 1;
        break;
      case 'reject-import-row':
        summary.plannedRejectOperations += 1;
        break;
      case 'defer-review':
        summary.plannedDeferOperations += 1;
        break;
    }

    summary.blockerCount += row.blockers.length;
  }

  summary.canCommit = summary.totalRows > 0 && summary.blockingRows === 0;
  return summary;
}

/** Resolves either a plan result or a bare rows array into a rows array. */
function resolveRows(
  resultOrRows:
    | RosterImportCommitPreviewPlanResult
    | RosterImportCommitPreviewPlanRow[]
): RosterImportCommitPreviewPlanRow[] {
  return Array.isArray(resultOrRows) ? resultOrRows : resultOrRows.rows;
}

/** Plan rows that name a future operation to perform: `ready-to-link` / `ready-to-create`. */
export function getRosterImportCommitPreviewPlanRowsReadyForCommit(
  resultOrRows:
    | RosterImportCommitPreviewPlanResult
    | RosterImportCommitPreviewPlanRow[]
): RosterImportCommitPreviewPlanRow[] {
  return resolveRows(resultOrRows).filter(
    (row) =>
      row.planStatus === 'ready-to-link' ||
      row.planStatus === 'ready-to-create'
  );
}

/** Plan rows that block the commit (any `blocked-*` status). */
export function getRosterImportCommitPreviewPlanRowsBlockingCommit(
  resultOrRows:
    | RosterImportCommitPreviewPlanResult
    | RosterImportCommitPreviewPlanRow[]
): RosterImportCommitPreviewPlanRow[] {
  return resolveRows(resultOrRows).filter((row) =>
    isBlockingStatus(row.planStatus)
  );
}

// Re-exported for callers that already hold a slice 5 result and want the entries.
export type { AppliedRosterImportIdentityReviewDecisionResult };
