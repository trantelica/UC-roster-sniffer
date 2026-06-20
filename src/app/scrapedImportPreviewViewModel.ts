import type { RosterImportPreviewRow } from '../engine/rosterImportPreview';
import type { UteScrapedRecordType } from '../engine/uteConferenceScrapedJsonAdapter';
import type {
  UteScrapedJsonReadinessStatus,
  UteScrapedJsonReadinessTarget,
} from '../engine/uteConferenceScrapedJsonReadinessReport';
import {
  getUteScrapedJsonImportReadyTargets,
  getUteScrapedJsonTargetsNeedingReview,
  getUteScrapedJsonBlockedTargets,
  getUteScrapedJsonEmptyTargets,
} from '../engine/uteConferenceScrapedJsonReadinessReport';
import {
  buildScrapedJsonImportRosterAwareReview,
  findExistingRosterTeamForContext,
  type ScrapedImportRosterAwareReview,
  type ScrapedImportReviewDecisionMap,
} from '../engine/uteConferenceScrapedJsonImportRosterAwareReview';
import {
  buildScrapedJsonImportStagedProjection,
  type ScrapedImportStagedProjection,
} from '../engine/uteConferenceScrapedJsonImportStagedProjection';
import {
  buildScrapedJsonImportFutureCommitReadiness,
  type ScrapedImportFutureCommitReadiness,
} from '../engine/uteConferenceScrapedJsonImportFutureReadiness';
import type {
  ScrapedImportPreviewArtifactSource,
  ScrapedImportPreviewArtifactTarget,
} from '../engine/uteConferenceScrapedJsonImportPreviewArtifact';
import {
  buildScrapedJsonImportTransactionPlan,
  type ScrapedImportTransactionPlanResult,
} from '../engine/uteConferenceScrapedJsonImportTransactionPlan';
import type { Team } from '../domain/types';
import type {
  UteScrapedJsonImportSession,
  UteScrapedJsonImportSessionStatus,
} from '../engine/uteConferenceScrapedJsonImportSession';
import { getUteScrapedJsonImportSessionSelectableTargets } from '../engine/uteConferenceScrapedJsonImportSession';
import { summarizeUteScrapedJsonImportSessionReviewState } from '../engine/uteConferenceScrapedJsonImportSessionReviewDecisions';

/**
 * Phase 5 slice 16: a PURE, deterministic VIEW MODEL for the read-only scraped JSON
 * import UI shell.
 *
 * It takes a slice 14 import session (optionally with a selected target) and reshapes
 * the already-derived engine outputs — readiness report, selection summary, canonical
 * mapping, preview rows, and review state — into a flat, render-ready structure. It
 * COMPOSES existing engine helpers only and contains NO readiness/mapping/matching/
 * import business logic: it never re-derives readiness, never mutates the session or
 * payload, and never applies/commits anything. It exists so the React component can
 * stay a thin renderer and so this presentation mapping can be unit-tested in the
 * node test environment without a DOM.
 */

export type ScrapedImportTargetOption = {
  sourceTargetId: string;
  teamName: string | null;
  districtName: string | null;
  ageDivisionLabel: string | null;
  readinessStatus: UteScrapedJsonReadinessStatus;
  rowCount: number;
};

export type ScrapedImportPreviewRowView = {
  rowIndex: number;
  playerName: string | null;
  status: RosterImportPreviewRow['status'];
};

export type ScrapedImportIssueView = {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
};

export type ScrapedImportCanonicalContextView = {
  seasonId: string | null;
  districtId: string | null;
  ageDivisionId: string | null;
  teamClassification: string | null;
  contextConfidence: string;
};

export type ScrapedImportReviewSummaryView = {
  reviewedRowCount: number;
  unreviewedRowCount: number;
  confirmedRowCount: number;
  needsReviewRowCount: number;
  ignoredForReviewRowCount: number;
};

export type ScrapedImportSelectedView = {
  sourceTargetId: string;
  recordType: UteScrapedRecordType;
  teamName: string | null;
  readinessStatus: UteScrapedJsonReadinessStatus;
  rowCount: number;
  /** ready or ready-with-warnings — the only states this UI calls importable. */
  importable: boolean;
  needsReview: boolean;
  blocked: boolean;
  empty: boolean;
  canonicalContext: ScrapedImportCanonicalContextView | null;
  issues: ScrapedImportIssueView[];
  readinessReasons: string[];
  /** Player preview rows (empty for coach targets). Read-only; order preserved. */
  playerPreviewRows: ScrapedImportPreviewRowView[];
  /** Coach preview rows (empty for player targets). Read-only; raw names/titles preserved. */
  coachPreviewRows: ScrapedImportCoachRowView[];
  /** Coach preview summary (present only for coach targets). */
  coachPreviewSummary: ScrapedImportCoachSummaryView | null;
  /** Present only when player preview rows exist. */
  reviewSummary: ScrapedImportReviewSummaryView | null;
};

export type ScrapedImportCoachRowView = {
  rowIndex: number;
  rawName: string | null;
  rawTitle: string | null;
};

export type ScrapedImportCoachSummaryView = {
  totalRows: number;
  withName: number;
  missingName: number;
  withTitle: number;
  missingTitle: number;
};

export type ScrapedImportPreviewViewModel = {
  status: UteScrapedJsonImportSessionStatus;
  invalidSource: boolean;
  recordType: UteScrapedRecordType;
  source: {
    organization: string | null;
    event: string | null;
    year: string | null;
    ageDivision: string | null;
    totalTeams: number;
    totalRows: number;
  } | null;
  summary: {
    totalTargets: number;
    selectableTargets: number;
    blockedTargets: number;
    emptyTargets: number;
    canSelectTarget: boolean;
    canProceedToPreview: boolean;
    canProceedWithoutReview: boolean;
  };
  /** All selectable targets (ready, ready-with-warnings, and needs-review). */
  selectableTargets: ScrapedImportTargetOption[];
  /** Ready / ready-with-warnings targets only (selectable, no review required). */
  readyTargets: ScrapedImportTargetOption[];
  /** Needs-review targets (selectable, but flagged for review). */
  needsReviewTargets: ScrapedImportTargetOption[];
  blockedTargets: ScrapedImportTargetOption[];
  emptyTargets: ScrapedImportTargetOption[];
  hasSelection: boolean;
  selected: ScrapedImportSelectedView | null;
  /**
   * Roster-aware identity review + decision-aware dry-run for the selected target
   * (preview only). Reflects the existing roster for the target context and the
   * reviewer's in-memory decisions.
   */
  rosterReview: ScrapedImportRosterAwareReview;
  /**
   * Staged, in-memory projected roster for the selected target (preview only). Stageable
   * only when the dry run is clean; otherwise carries the reason it is unavailable.
   */
  stagedProjection: ScrapedImportStagedProjection;
  /**
   * Future-import-commit readiness gate (slice 20, preview only). Summarizes whether the
   * current staged projection would be safe to commit in a future approved slice.
   */
  futureReadiness: ScrapedImportFutureCommitReadiness;
  /** Source descriptor for an exportable preview artifact (slice 20). */
  artifactSource: ScrapedImportPreviewArtifactSource;
  /** Target descriptor for an exportable preview artifact (slice 20). */
  artifactTarget: ScrapedImportPreviewArtifactTarget;
  /**
   * Reversible in-memory import transaction plan (slice 21, preview only). Built with
   * deterministic sentinel ids for display; `planned` only when readiness is ready,
   * otherwise `rejected` with the readiness blocking reasons. Never executed.
   */
  transactionPlan: ScrapedImportTransactionPlanResult;
};

export type ScrapedImportPreviewViewModelOptions = {
  /** Existing local roster teams to compare imported rows against. */
  existingTeams?: Team[];
  /** In-memory per-row identity review decisions. */
  reviewDecisions?: ScrapedImportReviewDecisionMap;
};

function toTargetOption(
  target: UteScrapedJsonReadinessTarget
): ScrapedImportTargetOption {
  return {
    sourceTargetId: target.sourceTargetId,
    teamName: target.teamName,
    districtName: target.districtName,
    ageDivisionLabel: target.ageDivisionLabel,
    readinessStatus: target.readinessStatus,
    rowCount: target.rowCount,
  };
}

/** Builds the read-only view model from a session. Pure; never mutates the session. */
export function buildScrapedJsonImportPreviewViewModel(
  session: UteScrapedJsonImportSession,
  options?: ScrapedImportPreviewViewModelOptions
): ScrapedImportPreviewViewModel {
  const summary = session.summary;
  const report = session.readinessReport;
  const existingTeams = options?.existingTeams ?? [];
  const reviewDecisions = options?.reviewDecisions ?? {};

  const selectableTargets = getUteScrapedJsonImportSessionSelectableTargets(
    session
  ).map(toTargetOption);
  const readyTargets = report
    ? getUteScrapedJsonImportReadyTargets(report).map(toTargetOption)
    : [];
  const needsReviewTargets = report
    ? getUteScrapedJsonTargetsNeedingReview(report).map(toTargetOption)
    : [];
  const blockedTargets = report
    ? getUteScrapedJsonBlockedTargets(report).map(toTargetOption)
    : [];
  const emptyTargets = report
    ? getUteScrapedJsonEmptyTargets(report).map(toTargetOption)
    : [];

  const source = session.sourceSummary
    ? {
        organization: session.sourceSummary.organization,
        event: session.sourceSummary.event,
        year: session.sourceSummary.year,
        ageDivision: session.sourceSummary.ageDivision,
        totalTeams: session.sourceSummary.totalTeams,
        totalRows: session.sourceSummary.totalRows,
      }
    : null;

  const selected = buildSelectedView(session);

  const rosterReview = buildScrapedJsonImportRosterAwareReview(
    session,
    existingTeams,
    reviewDecisions
  );
  // Locate the same existing team slice 18 matched, to supply the "actual" roster side.
  const ctx = session.selectedCanonicalContextMapping?.canonicalContext ?? null;
  const existingTeam = ctx
    ? findExistingRosterTeamForContext(existingTeams, {
        seasonId: ctx.seasonId,
        districtId: ctx.districtId,
        ageDivisionId: ctx.ageDivisionId,
        teamClassification: ctx.teamClassification,
      })
    : null;
  const stagedProjection = buildScrapedJsonImportStagedProjection(
    rosterReview,
    existingTeam
  );
  const futureReadiness = buildScrapedJsonImportFutureCommitReadiness(
    rosterReview,
    stagedProjection
  );

  // `name` (the chosen file/demo label) is known only to the component; it fills it in
  // when building the artifact. Organization/event/year come from the parsed source.
  const artifactSource: ScrapedImportPreviewArtifactSource = {
    name: null,
    kind: session.recordType,
    organization: source?.organization ?? null,
    event: source?.event ?? null,
    year: source?.year ?? null,
  };
  const artifactTarget: ScrapedImportPreviewArtifactTarget = {
    teamName: selected?.teamName ?? null,
    existingTeamId: rosterReview.available ? rosterReview.existingTeamId : null,
    seasonId: selected?.canonicalContext?.seasonId ?? null,
    districtId: selected?.canonicalContext?.districtId ?? null,
    ageDivisionId: selected?.canonicalContext?.ageDivisionId ?? null,
    teamClassification: selected?.canonicalContext?.teamClassification ?? null,
  };

  // Deterministic sentinel id/timestamp keep the view model pure and stable for tests and
  // re-renders. A real timestamp/id is supplied only when an artifact is exported.
  const transactionPlan = buildScrapedJsonImportTransactionPlan({
    transactionId: `preview-transaction:${artifactTarget.existingTeamId ?? 'none'}`,
    generatedAt: 'in-memory-preview',
    source: artifactSource,
    target: artifactTarget,
    review: rosterReview,
    stagedProjection,
    readiness: futureReadiness,
  });

  return {
    status: session.status,
    invalidSource: session.status === 'invalid-source',
    recordType: session.recordType,
    source,
    summary: {
      totalTargets: summary.totalTargets,
      selectableTargets: summary.selectableTargets,
      blockedTargets: summary.blockedTargets,
      emptyTargets: summary.emptyTargets,
      canSelectTarget: summary.canSelectTarget,
      canProceedToPreview: summary.canProceedToPreview,
      canProceedWithoutReview: summary.canProceedWithoutReview,
    },
    selectableTargets,
    readyTargets,
    needsReviewTargets,
    blockedTargets,
    emptyTargets,
    hasSelection: selected !== null,
    selected,
    rosterReview,
    stagedProjection,
    futureReadiness,
    artifactSource,
    artifactTarget,
    transactionPlan,
  };
}

function buildSelectedView(
  session: UteScrapedJsonImportSession
): ScrapedImportSelectedView | null {
  const selectedTarget = session.selectedTarget;
  if (!selectedTarget) return null;

  const status = selectedTarget.readinessStatus;
  const mapping = session.selectedCanonicalContextMapping;
  const canonicalContext: ScrapedImportCanonicalContextView | null = mapping
    ? {
        seasonId: mapping.canonicalContext.seasonId,
        districtId: mapping.canonicalContext.districtId,
        ageDivisionId: mapping.canonicalContext.ageDivisionId,
        teamClassification: mapping.canonicalContext.teamClassification,
        contextConfidence: mapping.contextConfidence,
      }
    : null;

  const playerPreviewRows: ScrapedImportPreviewRowView[] = (
    session.selectedPlayerPreviewResult?.rows ?? []
  ).map((row) => ({
    rowIndex: row.rowIndex,
    playerName: row.playerName,
    status: row.status,
  }));

  const reviewSummary =
    playerPreviewRows.length > 0
      ? toReviewSummary(session)
      : null;

  const coachResult = session.selectedCoachPreviewResult;
  const coachPreviewRows: ScrapedImportCoachRowView[] = (
    coachResult?.rows ?? []
  ).map((row) => ({
    rowIndex: row.rowIndex,
    rawName: row.rawName,
    rawTitle: row.rawTitle,
  }));
  const coachPreviewSummary: ScrapedImportCoachSummaryView | null = coachResult
    ? {
        totalRows: coachResult.summary.totalRows,
        withName: coachResult.summary.withName,
        missingName: coachResult.summary.missingName,
        withTitle: coachResult.summary.withTitle,
        missingTitle: coachResult.summary.missingTitle,
      }
    : null;

  return {
    sourceTargetId: selectedTarget.sourceTargetId,
    recordType: selectedTarget.recordType,
    teamName: selectedTarget.readinessTarget.teamName,
    readinessStatus: status,
    rowCount: selectedTarget.rowCount,
    importable: status === 'ready' || status === 'ready-with-warnings',
    needsReview: status === 'needs-review',
    blocked: status === 'blocked',
    empty: status === 'empty',
    canonicalContext,
    issues: selectedTarget.issues.map((issue) => ({
      code: issue.code,
      severity: issue.severity,
      message: issue.message,
    })),
    readinessReasons: [...selectedTarget.readinessTarget.readinessReasons],
    playerPreviewRows,
    coachPreviewRows,
    coachPreviewSummary,
    reviewSummary,
  };
}

function toReviewSummary(
  session: UteScrapedJsonImportSession
): ScrapedImportReviewSummaryView {
  const reviewState = summarizeUteScrapedJsonImportSessionReviewState(session);
  return {
    reviewedRowCount: reviewState.reviewedRowCount,
    unreviewedRowCount: reviewState.unreviewedRowCount,
    confirmedRowCount: reviewState.confirmedRowCount,
    needsReviewRowCount: reviewState.needsReviewRowCount,
    ignoredForReviewRowCount: reviewState.ignoredForReviewRowCount,
  };
}
