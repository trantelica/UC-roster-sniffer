import type {
  ScrapedImportRosterAwareReview,
  ScrapedImportReviewRowOutcome,
} from './uteConferenceScrapedJsonImportRosterAwareReview';
import type { ScrapedImportStagedProjection } from './uteConferenceScrapedJsonImportStagedProjection';
import type {
  ScrapedImportFutureCommitReadiness,
  ScrapedImportReadinessBlockingReason,
} from './uteConferenceScrapedJsonImportFutureReadiness';
import { UTE_CONFERENCE_SCRAPED_JSON_IMPORT_FUTURE_READINESS_LOGIC_VERSION } from './uteConferenceScrapedJsonImportFutureReadiness';
import type {
  ScrapedImportPreviewArtifactSource,
  ScrapedImportPreviewArtifactTarget,
} from './uteConferenceScrapedJsonImportPreviewArtifact';

/**
 * Phase 5 slice 21: PURE, deterministic IN-MEMORY IMPORT TRANSACTION PLAN — ENGINE ONLY.
 *
 * It answers: "when the current staged import preview is READY for a future commit, what
 * would that commit do — exactly what would be added, linked (no-op), deferred, or
 * rejected — and how could it be reversed?" The plan is a DESIGN / SAFETY CONTRACT for a
 * future, explicitly approved import-write slice. It is NOT a commit.
 *
 * It COMPOSES the slice 18 review (per-row outcomes), the slice 19 staged projection
 * (projected roster totals), and the slice 20 readiness gate. It invents no parallel
 * import model and re-derives no matching/decision logic. Planning REQUIRES readiness:
 * when `isReadyForFutureCommit` is false, a deterministic `rejected` result is returned
 * carrying the readiness blocking reasons, and NO add operations are produced.
 *
 * Guardrails: PREVIEW ONLY. Building a plan applies, commits, saves, writes, or persists
 * NOTHING; it touches no localStorage / IndexedDB / backend / files / app state; it never
 * mutates the review, staged projection, readiness, or any input. Loaded roster records
 * stay authoritative — the plan never removes, suppresses, rewrites, reorders, merges, or
 * nullifies rostered names. Raw imported and existing names are preserved exactly.
 * Caller-supplied `transactionId` / `generatedAt` keep output fully deterministic.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_IMPORT_TRANSACTION_PLAN_LOGIC_VERSION =
  'phase5-slice21-scraped-json-import-transaction-plan-v1';

const PREVIEW_NOTE =
  'Preview only. This transaction plan was NOT executed: no import was committed, applied, saved, or persisted, and no roster or prior-season data was changed. It is a reversible, in-memory design contract for a future, explicitly approved import-write slice.';

export type ScrapedImportTransactionAddOperation = {
  opKind: 'add';
  rowIndex: number;
  /** Raw imported player name, preserved exactly. */
  importedName: string | null;
  /** Raw name that would become a new roster record, preserved exactly. */
  projectedRecordName: string | null;
  /** Deterministic provisional ref for the would-be-added record (never a real id). */
  projectedRecordRef: string;
};

export type ScrapedImportTransactionLinkOperation = {
  opKind: 'link';
  rowIndex: number;
  /** Raw imported player name, preserved exactly. */
  importedName: string | null;
  linkTargetExistingRecordId: string | null;
  /** Raw existing roster name the row links to, preserved exactly. */
  linkTargetExistingName: string | null;
  /** Links never create a roster record. */
  rosterMutation: 'none';
};

export type ScrapedImportTransactionDeferredRow = {
  rowIndex: number;
  importedName: string | null;
};

export type ScrapedImportTransactionRejectedRow = {
  rowIndex: number;
  importedName: string | null;
  outcome: ScrapedImportReviewRowOutcome;
  reasonCode: 'unresolved' | 'blocked';
};

export type ScrapedImportTransactionRosterSummary = {
  teamId: string;
  playerCount: number;
};

export type ScrapedImportTransactionDeltaSummary = {
  addedCount: number;
  /** Linked rows are no-ops for roster record count. */
  linkedNoopCount: number;
  deferredExcludedCount: number;
  rejectedExcludedCount: number;
  /** Only additions change the roster record count; links/deferred/rejected do not. */
  netRosterRecordChange: number;
};

export type ScrapedImportTransactionRollbackPlan = {
  /** Provisional refs that an undo would remove (one per add operation). */
  removableAddedRecordRefs: string[];
  removableAddedCount: number;
  /** Links require no roster removal on undo. */
  noopLinkCount: number;
  /** Deferred rows were never applied, so undo does nothing for them. */
  neverAppliedDeferredCount: number;
  /** Rejected rows were never applied, so undo does nothing for them. */
  neverAppliedRejectedCount: number;
  /** Player count the roster returns to after a full undo (the before count). */
  restoresToPlayerCount: number;
  reversible: boolean;
  summary: string;
};

export type ScrapedImportTransactionAudit = {
  logicVersion: string;
  readinessLogicVersion: string;
  transactionId: string;
  generatedAt: string;
  /** Always false: this plan describes a hypothetical commit only. */
  executed: false;
  note: string;
};

export type ScrapedImportTransactionReadinessSnapshot = {
  isReadyForFutureCommit: boolean;
  readyAdditions: number;
  readyLinks: number;
  deferredRows: number;
  unresolvedRows: number;
  blockedRows: number;
  totalIncomingRows: number;
  totalProjectedRosterRows: number | null;
};

export type ScrapedImportTransactionPlanPlanned = {
  status: 'planned';
  previewOnly: true;
  executed: false;
  transactionId: string;
  generatedAt: string;
  source: ScrapedImportPreviewArtifactSource;
  target: ScrapedImportPreviewArtifactTarget;
  readiness: ScrapedImportTransactionReadinessSnapshot;
  addOperations: ScrapedImportTransactionAddOperation[];
  linkOperations: ScrapedImportTransactionLinkOperation[];
  deferredRows: ScrapedImportTransactionDeferredRow[];
  /** Normally empty when planning succeeds (readiness guarantees no unresolved/blocked). */
  rejectedRows: ScrapedImportTransactionRejectedRow[];
  beforeRosterSummary: ScrapedImportTransactionRosterSummary;
  afterRosterSummary: ScrapedImportTransactionRosterSummary;
  rosterDeltaSummary: ScrapedImportTransactionDeltaSummary;
  rollbackPlan: ScrapedImportTransactionRollbackPlan;
  audit: ScrapedImportTransactionAudit;
};

export type ScrapedImportTransactionPlanRejectedReason =
  | 'not-ready'
  | 'staged-projection-unavailable'
  | 'review-unavailable';

export type ScrapedImportTransactionPlanRejected = {
  status: 'rejected';
  previewOnly: true;
  executed: false;
  transactionId: string;
  generatedAt: string;
  reason: ScrapedImportTransactionPlanRejectedReason;
  message: string;
  blockingReasons: ScrapedImportReadinessBlockingReason[];
  /** Unresolved/blocked/invalid rows for inspection (empty when review unavailable). */
  rejectedRows: ScrapedImportTransactionRejectedRow[];
  source: ScrapedImportPreviewArtifactSource;
  target: ScrapedImportPreviewArtifactTarget;
  audit: ScrapedImportTransactionAudit;
};

export type ScrapedImportTransactionPlanResult =
  | ScrapedImportTransactionPlanPlanned
  | ScrapedImportTransactionPlanRejected;

export type BuildScrapedImportTransactionPlanInput = {
  /** Caller-supplied stable id (keeps output deterministic). */
  transactionId: string;
  /** Caller-supplied stable timestamp (keeps output deterministic). */
  generatedAt: string;
  source: ScrapedImportPreviewArtifactSource;
  target: ScrapedImportPreviewArtifactTarget;
  review: ScrapedImportRosterAwareReview;
  stagedProjection: ScrapedImportStagedProjection;
  readiness: ScrapedImportFutureCommitReadiness;
};

function buildAudit(
  transactionId: string,
  generatedAt: string
): ScrapedImportTransactionAudit {
  return {
    logicVersion: UTE_CONFERENCE_SCRAPED_JSON_IMPORT_TRANSACTION_PLAN_LOGIC_VERSION,
    readinessLogicVersion:
      UTE_CONFERENCE_SCRAPED_JSON_IMPORT_FUTURE_READINESS_LOGIC_VERSION,
    transactionId,
    generatedAt,
    executed: false,
    note: PREVIEW_NOTE,
  };
}

/** Unresolved/blocked/invalid rows from a review, in source order. */
function collectRejectedRows(
  review: ScrapedImportRosterAwareReview
): ScrapedImportTransactionRejectedRow[] {
  if (!review.available) return [];
  return review.rows
    .filter(
      (row) => row.outcome === 'blocked-unresolved' || row.outcome === 'blocked'
    )
    .map((row) => ({
      rowIndex: row.rowIndex,
      importedName: row.playerName,
      outcome: row.outcome,
      reasonCode: row.outcome === 'blocked-unresolved' ? 'unresolved' : 'blocked',
    }));
}

function rejected(
  input: BuildScrapedImportTransactionPlanInput,
  reason: ScrapedImportTransactionPlanRejectedReason,
  message: string
): ScrapedImportTransactionPlanRejected {
  return {
    status: 'rejected',
    previewOnly: true,
    executed: false,
    transactionId: input.transactionId,
    generatedAt: input.generatedAt,
    reason,
    message,
    blockingReasons: input.readiness.blockingReasons,
    rejectedRows: collectRejectedRows(input.review),
    source: input.source,
    target: input.target,
    audit: buildAudit(input.transactionId, input.generatedAt),
  };
}

/**
 * Builds a reversible, in-memory import transaction plan from the current review, staged
 * projection, and readiness gate. Pure; never mutates any input. When readiness is not
 * ready, returns a deterministic `rejected` result with the readiness blocking reasons
 * and produces no add operations.
 */
export function buildScrapedJsonImportTransactionPlan(
  input: BuildScrapedImportTransactionPlanInput
): ScrapedImportTransactionPlanResult {
  const { review, stagedProjection, readiness } = input;

  if (!readiness.isReadyForFutureCommit) {
    return rejected(input, 'not-ready', readiness.explanation);
  }
  // Readiness being ready already implies the review is available and the staged
  // projection is stageable; these guards are defensive and keep the types narrow.
  if (!review.available) {
    return rejected(
      input,
      'review-unavailable',
      'Roster-aware review is unavailable, so no transaction plan can be built.'
    );
  }
  if (!stagedProjection.stageable) {
    return rejected(
      input,
      'staged-projection-unavailable',
      stagedProjection.message
    );
  }

  const teamId = stagedProjection.existingTeamId;

  const addOperations: ScrapedImportTransactionAddOperation[] = review.rows
    .filter((row) => row.outcome === 'projected-create')
    .map((row) => ({
      opKind: 'add',
      rowIndex: row.rowIndex,
      importedName: row.playerName,
      projectedRecordName: row.projectedNewPlayerName ?? row.playerName,
      projectedRecordRef: `${teamId}#projected-new#${row.rowIndex}`,
    }));

  const linkOperations: ScrapedImportTransactionLinkOperation[] = review.rows
    .filter((row) => row.outcome === 'projected-link')
    .map((row) => ({
      opKind: 'link',
      rowIndex: row.rowIndex,
      importedName: row.playerName,
      linkTargetExistingRecordId: row.linkTargetExistingRecordId,
      linkTargetExistingName: row.linkTargetExistingName,
      rosterMutation: 'none',
    }));

  const deferredRows: ScrapedImportTransactionDeferredRow[] = review.rows
    .filter((row) => row.outcome === 'deferred')
    .map((row) => ({ rowIndex: row.rowIndex, importedName: row.playerName }));

  // Readiness guarantees none, but keep the field populated from the single source.
  const rejectedRows = collectRejectedRows(review);

  const beforeRosterSummary: ScrapedImportTransactionRosterSummary = {
    teamId,
    playerCount: stagedProjection.actualRosterCount,
  };
  const afterRosterSummary: ScrapedImportTransactionRosterSummary = {
    teamId,
    playerCount: stagedProjection.projectedRosterCount,
  };

  const rosterDeltaSummary: ScrapedImportTransactionDeltaSummary = {
    addedCount: addOperations.length,
    linkedNoopCount: linkOperations.length,
    deferredExcludedCount: deferredRows.length,
    rejectedExcludedCount: rejectedRows.length,
    netRosterRecordChange: addOperations.length,
  };

  const rollbackPlan: ScrapedImportTransactionRollbackPlan = {
    removableAddedRecordRefs: addOperations.map((op) => op.projectedRecordRef),
    removableAddedCount: addOperations.length,
    noopLinkCount: linkOperations.length,
    neverAppliedDeferredCount: deferredRows.length,
    neverAppliedRejectedCount: rejectedRows.length,
    restoresToPlayerCount: beforeRosterSummary.playerCount,
    reversible: true,
    summary: `Undo would remove ${addOperations.length} added record${addOperations.length === 1 ? '' : 's'} and restore the roster to ${beforeRosterSummary.playerCount} player${beforeRosterSummary.playerCount === 1 ? '' : 's'}. ${linkOperations.length} linked row${linkOperations.length === 1 ? '' : 's'} and ${deferredRows.length} deferred row${deferredRows.length === 1 ? '' : 's'} require no roster removal. No commit occurs in this preview.`,
  };

  const readinessSnapshot: ScrapedImportTransactionReadinessSnapshot = {
    isReadyForFutureCommit: readiness.isReadyForFutureCommit,
    readyAdditions: readiness.readyAdditions,
    readyLinks: readiness.readyLinks,
    deferredRows: readiness.deferredRows,
    unresolvedRows: readiness.unresolvedRows,
    blockedRows: readiness.blockedRows,
    totalIncomingRows: readiness.totalIncomingRows,
    totalProjectedRosterRows: readiness.totalProjectedRosterRows,
  };

  return {
    status: 'planned',
    previewOnly: true,
    executed: false,
    transactionId: input.transactionId,
    generatedAt: input.generatedAt,
    source: input.source,
    target: input.target,
    readiness: readinessSnapshot,
    addOperations,
    linkOperations,
    deferredRows,
    rejectedRows,
    beforeRosterSummary,
    afterRosterSummary,
    rosterDeltaSummary,
    rollbackPlan,
    audit: buildAudit(input.transactionId, input.generatedAt),
  };
}
