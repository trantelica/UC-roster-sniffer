import type {
  ScrapedImportRosterAwareReview,
  ScrapedImportIdentityMatchStatus,
  ScrapedImportReviewRowOutcome,
  ScrapedImportReviewDecisionKind,
} from './uteConferenceScrapedJsonImportRosterAwareReview';
import type { ScrapedImportStagedProjection } from './uteConferenceScrapedJsonImportStagedProjection';
import type { ScrapedImportFutureCommitReadiness } from './uteConferenceScrapedJsonImportFutureReadiness';
import type { ScrapedImportTransactionPlanResult } from './uteConferenceScrapedJsonImportTransactionPlan';
import type {
  ScrapedImportExecutionResult,
  ScrapedImportUndoResult,
} from './uteConferenceScrapedJsonImportExecution';

/**
 * Phase 5 slice 20: PURE, deterministic PREVIEW ARTIFACT builder — ENGINE ONLY.
 *
 * It assembles a single inspectable/debuggable snapshot of the CURRENT in-memory import
 * preview state (source/target summary, future-readiness summary, staged projection
 * summary, and per-row statuses) so a reviewer can export it as JSON.
 *
 * It COMPOSES the slice 18 review, the slice 19 staged projection, and the slice 20
 * readiness gate; it re-derives none of their logic. The `generatedAt` stamp is supplied
 * by the caller so the artifact is fully deterministic and testable.
 *
 * Guardrails: PREVIEW ONLY. The artifact is a read-only description of in-memory state.
 * Building it applies, commits, saves, writes, or persists NOTHING; it touches no
 * localStorage / IndexedDB / backend; it never mutates the review, staged projection,
 * readiness, or any input. Raw imported and existing names are preserved exactly.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_IMPORT_PREVIEW_ARTIFACT_LOGIC_VERSION =
  'phase5-slice20-scraped-json-import-preview-artifact-v1';

export const SCRAPED_JSON_IMPORT_PREVIEW_ARTIFACT_KIND =
  'uc-roster-sniffer:scraped-json-import-preview-artifact';

export type ScrapedImportPreviewArtifactSource = {
  name: string | null;
  kind: string | null;
  organization: string | null;
  event: string | null;
  year: string | null;
};

export type ScrapedImportPreviewArtifactTarget = {
  teamName: string | null;
  existingTeamId: string | null;
  seasonId: string | null;
  districtId: string | null;
  ageDivisionId: string | null;
  teamClassification: string | null;
};

export type ScrapedImportPreviewArtifactRow = {
  rowIndex: number;
  importedName: string | null;
  matchStatus: ScrapedImportIdentityMatchStatus;
  outcome: ScrapedImportReviewRowOutcome;
  decision: ScrapedImportReviewDecisionKind | null;
  linkTargetExistingName: string | null;
};

export type ScrapedImportPreviewArtifact = {
  artifactKind: typeof SCRAPED_JSON_IMPORT_PREVIEW_ARTIFACT_KIND;
  logicVersion: string;
  /** Always true: this artifact describes preview state only. */
  previewOnly: true;
  /** Human-readable reminder that no commit/apply/save/persistence occurred. */
  note: string;
  /** Caller-supplied generation timestamp (kept verbatim for determinism). */
  generatedAt: string;
  reviewAvailable: boolean;
  source: ScrapedImportPreviewArtifactSource;
  target: ScrapedImportPreviewArtifactTarget;
  readiness: {
    isReadyForFutureCommit: boolean;
    readyAdditions: number;
    readyLinks: number;
    deferredRows: number;
    blockedRows: number;
    unresolvedRows: number;
    totalIncomingRows: number;
    totalProjectedRosterRows: number | null;
    blockingReasonCodes: string[];
    explanation: string;
  };
  stagedProjection:
    | { stageable: false; reason: string }
    | {
        stageable: true;
        existingTeamId: string;
        actualRosterCount: number;
        stagedNewCount: number;
        stagedLinkCount: number;
        deferredCount: number;
        projectedRosterCount: number;
      };
  rows: ScrapedImportPreviewArtifactRow[];
  /**
   * Optional slice 21 transaction-plan summary. Null when no plan was supplied. Always
   * marked `executed: false` — the plan is never run by building this artifact.
   */
  transactionPlan: ScrapedImportPreviewArtifactTransactionPlan | null;
  /**
   * Slice 22 in-memory execution state. `notExecuted` before any execution; `executed`
   * after an explicit in-memory execution; `undone` after an undo. Always `durable: false`
   * / `persisted: false` — this artifact never implies a durable save.
   */
  inMemoryExecution: ScrapedImportPreviewArtifactInMemoryExecution;
};

export type ScrapedImportPreviewArtifactInMemoryExecution =
  | { status: 'notExecuted'; durable: false; persisted: false }
  | {
      status: 'executed';
      durable: false;
      persisted: false;
      transactionId: string;
      executedAt: string;
      appliedAdditionCount: number;
      noOpLinkCount: number;
      skippedDeferredCount: number;
      skippedRejectedCount: number;
      beforeRosterCount: number;
      afterRosterCount: number;
      netRosterRecordChange: number;
      undoSummary: { removableAdditionCount: number; restoresToPlayerCount: number };
    }
  | {
      status: 'undone';
      durable: false;
      persisted: false;
      transactionId: string;
      undoneAt: string;
      removedAdditionCount: number;
      restoredRosterCount: number;
    };

export type ScrapedImportPreviewArtifactTransactionPlan = {
  status: 'planned' | 'rejected';
  /** Always false: the plan describes a hypothetical commit only. */
  executed: false;
  transactionId: string;
  generatedAt: string;
  addCount: number;
  linkCount: number;
  deferredCount: number;
  rejectedCount: number;
  /** Net roster-record change for a planned commit; null when rejected. */
  netRosterRecordChange: number | null;
  blockingReasonCodes: string[];
};

const PREVIEW_NOTE =
  'Preview only. No import was committed, applied, saved, or persisted; no roster or prior-season data was changed. This artifact describes in-memory preview state for inspection only.';

export type BuildScrapedImportPreviewArtifactInput = {
  generatedAt: string;
  source: ScrapedImportPreviewArtifactSource;
  target: ScrapedImportPreviewArtifactTarget;
  review: ScrapedImportRosterAwareReview;
  stagedProjection: ScrapedImportStagedProjection;
  readiness: ScrapedImportFutureCommitReadiness;
  /** Optional slice 21 transaction plan to summarize in the artifact (never executed). */
  transactionPlan?: ScrapedImportTransactionPlanResult;
  /** Optional slice 22 in-memory execution result (in-memory only; never durable). */
  execution?: ScrapedImportExecutionResult;
  /** Optional slice 22 undo result; when `undone`, supersedes the execution status. */
  undo?: ScrapedImportUndoResult;
};

function summarizeInMemoryExecution(
  execution: ScrapedImportExecutionResult | undefined,
  undo: ScrapedImportUndoResult | undefined
): ScrapedImportPreviewArtifactInMemoryExecution {
  if (undo && undo.status === 'undone') {
    return {
      status: 'undone',
      durable: false,
      persisted: false,
      transactionId: undo.transactionId,
      undoneAt: undo.undoneAt,
      removedAdditionCount: undo.removedAdditionCount,
      restoredRosterCount: undo.afterUndoRosterSummary.playerCount,
    };
  }
  if (execution && execution.status === 'executed') {
    return {
      status: 'executed',
      durable: false,
      persisted: false,
      transactionId: execution.transactionId,
      executedAt: execution.executedAt,
      appliedAdditionCount: execution.appliedAdditions.length,
      noOpLinkCount: execution.noOpLinks.length,
      skippedDeferredCount: execution.skippedDeferredRows.length,
      skippedRejectedCount: execution.skippedRejectedRows.length,
      beforeRosterCount: execution.beforeRosterSummary.playerCount,
      afterRosterCount: execution.afterRosterSummary.playerCount,
      netRosterRecordChange: execution.rosterDeltaSummary.netRosterRecordChange,
      undoSummary: {
        removableAdditionCount: execution.undoPlan.removableAdditionCount,
        restoresToPlayerCount: execution.undoPlan.restoresToPlayerCount,
      },
    };
  }
  return { status: 'notExecuted', durable: false, persisted: false };
}

function summarizeTransactionPlan(
  plan: ScrapedImportTransactionPlanResult | undefined
): ScrapedImportPreviewArtifactTransactionPlan | null {
  if (!plan) return null;
  if (plan.status === 'planned') {
    return {
      status: 'planned',
      executed: false,
      transactionId: plan.transactionId,
      generatedAt: plan.generatedAt,
      addCount: plan.addOperations.length,
      linkCount: plan.linkOperations.length,
      deferredCount: plan.deferredRows.length,
      rejectedCount: plan.rejectedRows.length,
      netRosterRecordChange: plan.rosterDeltaSummary.netRosterRecordChange,
      blockingReasonCodes: [],
    };
  }
  return {
    status: 'rejected',
    executed: false,
    transactionId: plan.transactionId,
    generatedAt: plan.generatedAt,
    addCount: 0,
    linkCount: 0,
    deferredCount: 0,
    rejectedCount: plan.rejectedRows.length,
    netRosterRecordChange: null,
    blockingReasonCodes: plan.blockingReasons.map((r) => r.code),
  };
}

/**
 * Builds the preview artifact snapshot from current in-memory state. Pure; never mutates
 * any input. Deterministic given the same inputs and `generatedAt`.
 */
export function buildScrapedJsonImportPreviewArtifact(
  input: BuildScrapedImportPreviewArtifactInput
): ScrapedImportPreviewArtifact {
  const { generatedAt, source, target, review, stagedProjection, readiness } = input;

  const rows: ScrapedImportPreviewArtifactRow[] = review.available
    ? review.rows.map((row) => ({
        rowIndex: row.rowIndex,
        importedName: row.playerName,
        matchStatus: row.matchStatus,
        outcome: row.outcome,
        decision: row.decision,
        linkTargetExistingName: row.linkTargetExistingName,
      }))
    : [];

  const stagedProjectionSummary: ScrapedImportPreviewArtifact['stagedProjection'] =
    stagedProjection.stageable
      ? {
          stageable: true,
          existingTeamId: stagedProjection.existingTeamId,
          actualRosterCount: stagedProjection.actualRosterCount,
          stagedNewCount: stagedProjection.stagedNewCount,
          stagedLinkCount: stagedProjection.stagedLinkCount,
          deferredCount: stagedProjection.deferredCount,
          projectedRosterCount: stagedProjection.projectedRosterCount,
        }
      : { stageable: false, reason: stagedProjection.reason };

  const inMemoryExecution = summarizeInMemoryExecution(input.execution, input.undo);
  const note =
    inMemoryExecution.status === 'executed'
      ? 'In-memory only. An import was executed into the current runtime/session roster view but is NOT durable: nothing was saved, persisted, or committed to any store, and it will not survive a reload. It can be undone in memory.'
      : inMemoryExecution.status === 'undone'
        ? 'In-memory only. A prior in-memory execution was undone; the runtime/session roster view was restored. Nothing durable was ever written.'
        : PREVIEW_NOTE;

  return {
    artifactKind: SCRAPED_JSON_IMPORT_PREVIEW_ARTIFACT_KIND,
    logicVersion: UTE_CONFERENCE_SCRAPED_JSON_IMPORT_PREVIEW_ARTIFACT_LOGIC_VERSION,
    previewOnly: true,
    note,
    generatedAt,
    reviewAvailable: review.available,
    source,
    target,
    readiness: {
      isReadyForFutureCommit: readiness.isReadyForFutureCommit,
      readyAdditions: readiness.readyAdditions,
      readyLinks: readiness.readyLinks,
      deferredRows: readiness.deferredRows,
      blockedRows: readiness.blockedRows,
      unresolvedRows: readiness.unresolvedRows,
      totalIncomingRows: readiness.totalIncomingRows,
      totalProjectedRosterRows: readiness.totalProjectedRosterRows,
      blockingReasonCodes: readiness.blockingReasons.map((r) => r.code),
      explanation: readiness.explanation,
    },
    stagedProjection: stagedProjectionSummary,
    rows,
    transactionPlan: summarizeTransactionPlan(input.transactionPlan),
    inMemoryExecution,
  };
}
