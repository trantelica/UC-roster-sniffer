import { createRosterImportPreviewIdentityMatches } from './rosterImportPreviewIdentityMatch';
import {
  applyRosterImportIdentityReviewAction,
  createRosterImportIdentityReviewDecision,
} from './rosterImportIdentityReviewDecision';
import type { RosterImportIdentityReviewDecision } from './rosterImportIdentityReviewDecision';
import { applyRosterImportIdentityReviewDecisionsToMatches } from './rosterImportIdentityReviewDecisionApplication';
import { createRosterImportCommitPreviewPlan } from './rosterImportCommitPreviewPlan';
import {
  createRosterImportApplicationProjection,
} from './rosterImportApplicationProjection';
import type {
  RosterImportApplicationProjectionStatus,
  RosterImportApplicationProjectionOperation,
} from './rosterImportApplicationProjection';
import type { UteScrapedJsonImportSession } from './uteConferenceScrapedJsonImportSession';

/**
 * Phase 5 slice 17: a PURE, deterministic DRY-RUN PROJECTION for a selected scraped
 * JSON import target — ENGINE ONLY.
 *
 * It answers, for the currently selected target of a slice 14 import session: "if this
 * target were imported as a NEW roster (there is no existing-roster registry wired into
 * the scraped pipeline yet), what would the deterministic Phase 5 import pipeline
 * project — what would be created/linked/flagged/rejected — in memory only?"
 *
 * It COMPOSES the existing Phase 5 helpers end to end and duplicates none of their
 * logic: slice 2 identity matching (against an EMPTY existing-roster registry, so every
 * preview row is a `no-match`), slice 3/5 review actions/decisions (a `create-new`
 * decision is the canonical resolution of a no-match), slice 6 commit-preview plan, and
 * slice 8 application projection. Because there are no existing records, no row can ever
 * be linked or merged — the projection only ever creates new entries or defers/blocks.
 *
 * Guardrails: this is PROJECTION ONLY. Nothing is applied, committed, written, linked,
 * created, merged, persisted, or mutated. The session, its payload, and its preview
 * rows are never mutated. Readiness is never bypassed — a blocked / empty / needs-review
 * target, a coach target, a missing player preview, or an incomplete canonical context
 * yields a deterministic `available: false` state rather than a forced projection. Raw
 * player names are carried through the existing helpers exactly. Decision ids are derived
 * from stable preview-row keys and timestamps are fixed sentinels, so output is identical
 * across repeated calls (no clock, no randomness).
 */

export const UTE_CONFERENCE_SCRAPED_JSON_IMPORT_DRY_RUN_PROJECTION_LOGIC_VERSION =
  'phase5-slice17-scraped-json-import-dry-run-projection-v1';

export type ScrapedImportDryRunUnavailableReason =
  | 'no-selection'
  | 'coach-target-not-projectable'
  | 'target-blocked'
  | 'target-empty'
  | 'target-needs-review'
  | 'no-player-preview'
  | 'missing-target-context'
  | 'plan-not-committable';

export type ScrapedImportDryRunRow = {
  sourceRowId: string | null;
  rowIndex: number;
  playerName: string | null;
  projectionStatus: RosterImportApplicationProjectionStatus;
  projectedOperation: RosterImportApplicationProjectionOperation;
  /** The raw player name a future apply WOULD create (provisional; never written). */
  projectedNewPlayerName: string | null;
};

export type ScrapedImportDryRunSummary = {
  totalRows: number;
  projectedCreateRows: number;
  projectedLinkRows: number;
  projectedRejectRows: number;
  projectedDeferRows: number;
  blockedRows: number;
  skippedRows: number;
};

export type ScrapedImportDryRunTargetContext = {
  seasonId: string;
  districtId: string;
  ageDivisionId: string;
  teamId: string;
};

export type ScrapedImportDryRunProjection =
  | {
      available: false;
      reason: ScrapedImportDryRunUnavailableReason;
      message: string;
    }
  | {
      available: true;
      /** This dry run assumes a first-time import with no existing roster to match against. */
      assumption: 'new-import-no-existing-roster';
      targetContext: ScrapedImportDryRunTargetContext;
      rows: ScrapedImportDryRunRow[];
      summary: ScrapedImportDryRunSummary;
    };

const UNAVAILABLE_MESSAGES: Record<ScrapedImportDryRunUnavailableReason, string> = {
  'no-selection': 'Select a target to see a dry-run projection.',
  'coach-target-not-projectable':
    'Coach targets are not part of the player-roster dry-run projection.',
  'target-blocked': 'This target is blocked, so no dry-run projection is produced.',
  'target-empty': 'This target has no rows to project.',
  'target-needs-review':
    'This target needs review before a dry-run projection can be produced.',
  'no-player-preview': 'This target has no player preview rows to project.',
  'missing-target-context':
    'The target is missing canonical season / district / age-division / team context, so no dry-run projection can be produced.',
  'plan-not-committable':
    'A dry-run projection could not be produced for this target.',
};

function unavailable(
  reason: ScrapedImportDryRunUnavailableReason
): ScrapedImportDryRunProjection {
  return { available: false, reason, message: UNAVAILABLE_MESSAGES[reason] };
}

/**
 * Builds the deterministic dry-run projection for a session's selected target. Pure;
 * never mutates the session, payload, or preview rows. Returns an explicit unavailable
 * state (rather than forcing a projection) whenever readiness or context is missing.
 */
export function buildScrapedJsonImportDryRunProjection(
  session: UteScrapedJsonImportSession
): ScrapedImportDryRunProjection {
  const selected = session.selectedTarget;
  if (!selected) return unavailable('no-selection');
  if (selected.recordType !== 'players') {
    return unavailable('coach-target-not-projectable');
  }

  // Never bypass readiness: only ready / ready-with-warnings targets are projectable.
  switch (selected.readinessStatus) {
    case 'blocked':
      return unavailable('target-blocked');
    case 'empty':
      return unavailable('target-empty');
    case 'needs-review':
      return unavailable('target-needs-review');
    default:
      break;
  }

  const previewRows = session.selectedPlayerPreviewResult?.rows ?? [];
  if (previewRows.length === 0) return unavailable('no-player-preview');

  const ctx = session.selectedCanonicalContextMapping?.canonicalContext ?? null;
  if (
    !ctx ||
    ctx.seasonId === null ||
    ctx.districtId === null ||
    ctx.ageDivisionId === null ||
    ctx.teamId === null
  ) {
    return unavailable('missing-target-context');
  }
  const targetContext: ScrapedImportDryRunTargetContext = {
    seasonId: ctx.seasonId,
    districtId: ctx.districtId,
    ageDivisionId: ctx.ageDivisionId,
    teamId: ctx.teamId,
  };

  // Compose the existing pipeline. With an empty existing-roster registry every row is
  // a no-match; a `create-new` decision is the canonical resolution of a no-match.
  const matches = createRosterImportPreviewIdentityMatches({
    previewRows,
    existingRosterRecords: [],
  });

  const decisions: RosterImportIdentityReviewDecision[] = [];
  for (const entry of matches.entries) {
    const actionResult = applyRosterImportIdentityReviewAction(entry, {
      action: 'create-new',
    });
    const created = createRosterImportIdentityReviewDecision(actionResult, {
      decisionId: `dry-run:${entry.previewSourceRowId}:${entry.previewRowIndex}`,
      createdAt: 'dry-run',
      reviewedAt: 'dry-run',
    });
    if (created.created && created.decision) decisions.push(created.decision);
  }

  const applied = applyRosterImportIdentityReviewDecisionsToMatches(
    matches.entries,
    decisions
  );
  const plan = createRosterImportCommitPreviewPlan({
    appliedEntries: applied.entries,
    targetContext,
  });
  const projection = createRosterImportApplicationProjection({
    plan,
    existingRosterRecords: [],
  });

  if (!projection.ok) return unavailable('plan-not-committable');

  return {
    available: true,
    assumption: 'new-import-no-existing-roster',
    targetContext,
    rows: projection.rows.map((row) => ({
      sourceRowId: row.previewSourceRowId,
      rowIndex: row.previewRowIndex,
      playerName: row.previewPlayerName,
      projectionStatus: row.projectionStatus,
      projectedOperation: row.projectedOperation,
      projectedNewPlayerName: row.projectedNewRecord?.playerName ?? null,
    })),
    summary: {
      totalRows: projection.summary.totalRows,
      projectedCreateRows: projection.summary.projectedCreateRows,
      projectedLinkRows: projection.summary.projectedLinkRows,
      projectedRejectRows: projection.summary.projectedRejectRows,
      projectedDeferRows: projection.summary.projectedDeferRows,
      blockedRows: projection.summary.blockedRows,
      skippedRows: projection.summary.skippedRows,
    },
  };
}
