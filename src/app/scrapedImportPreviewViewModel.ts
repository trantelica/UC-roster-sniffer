import type { RosterImportPreviewRow } from '../engine/rosterImportPreview';
import type { UteScrapedRecordType } from '../engine/uteConferenceScrapedJsonAdapter';
import type {
  UteScrapedJsonReadinessStatus,
  UteScrapedJsonReadinessTarget,
} from '../engine/uteConferenceScrapedJsonReadinessReport';
import {
  getUteScrapedJsonBlockedTargets,
  getUteScrapedJsonEmptyTargets,
} from '../engine/uteConferenceScrapedJsonReadinessReport';
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
  /** Present only when player preview rows exist. */
  reviewSummary: ScrapedImportReviewSummaryView | null;
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
  selectableTargets: ScrapedImportTargetOption[];
  blockedTargets: ScrapedImportTargetOption[];
  emptyTargets: ScrapedImportTargetOption[];
  hasSelection: boolean;
  selected: ScrapedImportSelectedView | null;
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
  session: UteScrapedJsonImportSession
): ScrapedImportPreviewViewModel {
  const summary = session.summary;
  const report = session.readinessReport;

  const selectableTargets = getUteScrapedJsonImportSessionSelectableTargets(
    session
  ).map(toTargetOption);
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
    blockedTargets,
    emptyTargets,
    hasSelection: selected !== null,
    selected,
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
