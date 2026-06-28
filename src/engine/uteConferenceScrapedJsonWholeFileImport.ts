import type { Team } from '../domain/types';
import {
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
} from './uteConferenceScrapedJsonImportSession';
import type { UteScrapedRecordType } from './uteConferenceScrapedJsonAdapter';
import {
  buildScrapedJsonImportRosterAwareReview,
  findExistingRosterTeamForContext,
  type ScrapedImportRosterAwareReview,
} from './uteConferenceScrapedJsonImportRosterAwareReview';
import {
  buildScrapedJsonImportStagedProjection,
  type ScrapedImportStagedProjection,
} from './uteConferenceScrapedJsonImportStagedProjection';
import {
  buildScrapedJsonImportFutureCommitReadiness,
  type ScrapedImportFutureCommitReadiness,
} from './uteConferenceScrapedJsonImportFutureReadiness';
import {
  buildScrapedJsonImportTransactionPlan,
} from './uteConferenceScrapedJsonImportTransactionPlan';
import type {
  ScrapedImportPreviewArtifactSource,
  ScrapedImportPreviewArtifactTarget,
} from './uteConferenceScrapedJsonImportPreviewArtifact';
import { executeUteConferenceScrapedJsonImportTransaction } from './uteConferenceScrapedJsonImportExecution';

/**
 * Completion Milestone B2: PURE, deterministic WHOLE-FILE scraped-JSON PLAYER import
 * planning + batch execution — ENGINE ONLY.
 *
 * It answers: "for one loaded scraped PLAYERS JSON file, which player-team targets are
 * safe to commit right now, and what would committing all of them at once do?" It does
 * NOT invent any readiness, matching, projection, or commit semantics — it COMPOSES the
 * exact same per-target pipeline the single-target B1 flow uses (session selection →
 * roster-aware review → staged projection → future readiness → transaction plan →
 * execution), evaluating every target with EMPTY review decisions so that nothing is
 * auto-resolved: a target is committable only when the existing pipeline already says it
 * is ready without any manual review.
 *
 * Two extra batch-only safety gates layer on top of the existing pipeline (never replacing
 * it):
 *  - a target whose district did not resolve to a registered district at HIGH confidence
 *    (C3) is skipped (`provisional-district`) until it is confirmed/registered; and
 *  - if two committable targets resolve to the SAME existing workspace team, only the first
 *    is committable and the rest are skipped (`duplicate-target`), so a batch can never
 *    double-apply additions to one team.
 *
 * Coach targets are never committed here (B2 is player-only). Targets with no existing
 * workspace team are skipped (`no-existing-team`) — like B1, this commits into EXISTING
 * teams only and never silently creates a team.
 *
 * Guardrails: pure; never mutates the payload, existing teams, or any input. Loaded roster
 * records stay authoritative (existing names preserved exactly and in order; only planned
 * additions are appended; links are no-ops; deferred/unresolved/blocked rows are never
 * added). Batch execution is ALL-OR-NOTHING: if any committable target fails at execution
 * time, the result is `rejected` and no committed teams are produced. Caller-supplied
 * `generatedAt` keeps execution output deterministic.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_WHOLE_FILE_IMPORT_LOGIC_VERSION =
  'milestoneB2-whole-file-player-import-v1';

export type WholeFileTargetStatus =
  | 'committable'
  | 'needs-review'
  | 'blocked'
  | 'empty'
  | 'provisional-district'
  | 'no-existing-team'
  | 'duplicate-target'
  | 'non-player';

/** One row of the whole-file summary table — render-ready, no business logic. */
export type WholeFileTargetSummary = {
  sourceTargetId: string;
  teamName: string | null;
  /** Raw scraped district name, preserved exactly. */
  districtName: string | null;
  /** Canonical resolved district id (registry id when resolved, else provisional slug). */
  districtId: string | null;
  /** True when the district resolved against the registry at high confidence (C3). */
  districtResolved: boolean;
  ageDivisionId: string | null;
  ageDivisionLabel: string | null;
  teamClassification: string | null;
  existingTeamId: string | null;
  status: WholeFileTargetStatus;
  committable: boolean;
  /** Rows that would be added as NEW roster records. */
  projectedAdditions: number;
  /** Rows that would link to an existing record (no new roster slot). */
  linkNoOps: number;
  /** Stable, plain-language reason code/messages for a non-committable target. */
  reasons: string[];
};

/**
 * Execution inputs for one committable target. Carried so the batch can build a real
 * transaction plan + execute it without re-deriving the pipeline. Engine-internal detail;
 * the UI only needs the summary rows + counts.
 */
export type WholeFileCommittableTarget = {
  sourceTargetId: string;
  existingTeam: Team;
  source: ScrapedImportPreviewArtifactSource;
  target: ScrapedImportPreviewArtifactTarget;
  review: ScrapedImportRosterAwareReview;
  stagedProjection: ScrapedImportStagedProjection;
  readiness: ScrapedImportFutureCommitReadiness;
  projectedAdditions: number;
};

export type WholeFilePlayerImportPlan = {
  recordType: UteScrapedRecordType;
  /** True only for a supported scraped PLAYERS file. */
  isPlayerFile: boolean;
  totalTargets: number;
  playerTargetCount: number;
  coachTargetCount: number;
  committableCount: number;
  /** Player targets that are not committable (everything skipped). */
  skippedCount: number;
  emptyCount: number;
  blockedCount: number;
  needsReviewCount: number;
  noExistingTeamCount: number;
  provisionalDistrictCount: number;
  duplicateTargetCount: number;
  /** Across committable teams only. */
  totalProjectedAdditions: number;
  totalLinkNoOps: number;
  /** Player targets whose district resolved against the registry at high confidence. */
  districtsResolvedCount: number;
  /** Player targets whose district is provisional/unknown (not registered). */
  districtsProvisionalCount: number;
  targets: WholeFileTargetSummary[];
  /** Engine-internal execution inputs for the committable targets, in source order. */
  committableTargets: WholeFileCommittableTarget[];
};

export type BuildWholeFilePlayerImportPlanInput = {
  payload: unknown;
  /** The committed workspace teams to compare/commit against. */
  existingTeams: Team[];
  /** C3 exact-name district registry lookup (name/source-label -> districtId). */
  districtRegistry?: Record<string, string>;
  /** Optional source label for the preview artifact (display only). */
  sourceName?: string | null;
};

/**
 * Builds the whole-file player import plan. Pure; never mutates inputs. Reuses the exact
 * single-target pipeline per target with EMPTY review decisions (no auto-resolution).
 */
export function buildWholeFilePlayerImportPlan(
  input: BuildWholeFilePlayerImportPlanInput
): WholeFilePlayerImportPlan {
  const baseSession = createUteScrapedJsonImportSessionFromPayload(input.payload, {
    districtRegistry: input.districtRegistry,
  });
  const recordType = baseSession.recordType;
  const isPlayerFile = recordType === 'players';

  const sourceSummary = baseSession.sourceSummary;
  const artifactSource: ScrapedImportPreviewArtifactSource = {
    name: input.sourceName ?? null,
    kind: recordType,
    organization: sourceSummary?.organization ?? null,
    event: sourceSummary?.event ?? null,
    year: sourceSummary?.year ?? null,
  };

  const report = baseSession.readinessReport;
  const reportTargets = report ? report.targets : [];

  const targets: WholeFileTargetSummary[] = [];
  const committableTargets: WholeFileCommittableTarget[] = [];
  const claimedExistingTeamIds = new Set<string>();

  for (const reportTarget of reportTargets) {
    const sourceTargetId = reportTarget.sourceTargetId;

    // Coach / non-player targets are never committed by B2.
    if (reportTarget.recordType !== 'players') {
      targets.push({
        sourceTargetId,
        teamName: reportTarget.teamName,
        districtName: reportTarget.districtName,
        districtId: reportTarget.canonicalDistrictId,
        districtResolved: false,
        ageDivisionId: reportTarget.canonicalAgeDivisionId,
        ageDivisionLabel: reportTarget.ageDivisionLabel,
        teamClassification: reportTarget.teamClassification,
        existingTeamId: null,
        status: 'non-player',
        committable: false,
        projectedAdditions: 0,
        linkNoOps: 0,
        reasons: ['Coach/non-player target — not imported by whole-file player import.'],
      });
      continue;
    }

    const session = selectUteScrapedJsonImportSessionTarget(baseSession, sourceTargetId);
    const mapping = session.selectedCanonicalContextMapping;
    const ctx = mapping?.canonicalContext ?? null;
    const districtConfidence = mapping?.district.confidence ?? 'unknown';
    const districtResolved = districtConfidence === 'high';

    const review = buildScrapedJsonImportRosterAwareReview(session, input.existingTeams, {});
    const existingTeam = ctx
      ? findExistingRosterTeamForContext(input.existingTeams, {
          seasonId: ctx.seasonId,
          districtId: ctx.districtId,
          ageDivisionId: ctx.ageDivisionId,
          teamClassification: ctx.teamClassification,
        })
      : null;
    const stagedProjection = buildScrapedJsonImportStagedProjection(review, existingTeam);
    const readiness = buildScrapedJsonImportFutureCommitReadiness(review, stagedProjection);

    const artifactTarget: ScrapedImportPreviewArtifactTarget = {
      teamName: reportTarget.teamName,
      existingTeamId: review.available ? review.existingTeamId : null,
      seasonId: ctx?.seasonId ?? null,
      districtId: ctx?.districtId ?? null,
      ageDivisionId: ctx?.ageDivisionId ?? null,
      teamClassification: ctx?.teamClassification ?? null,
    };

    // Sentinel id/timestamp keep this preview plan deterministic; a real plan is rebuilt at
    // execution time. Used only to read the planned/rejected verdict and projected counts.
    const previewPlan = buildScrapedJsonImportTransactionPlan({
      transactionId: `whole-file-preview:${sourceTargetId}`,
      generatedAt: 'whole-file-preview',
      source: artifactSource,
      target: artifactTarget,
      review,
      stagedProjection,
      readiness,
    });

    const additions = review.available
      ? review.rows.filter((r) => r.outcome === 'projected-create').length
      : 0;
    const links = review.available
      ? review.rows.filter((r) => r.outcome === 'projected-link').length
      : 0;

    const readinessStatus = session.selectedTarget?.readinessStatus ?? null;
    const reasons: string[] = [];

    let status: WholeFileTargetStatus;
    let committable = false;

    if (reportTarget.rowCount === 0) {
      status = 'empty';
      reasons.push('No rows to import.');
    } else if (readinessStatus === 'blocked') {
      status = 'blocked';
      pushReasons(reasons, reportTarget.readinessReasons);
    } else if (!districtResolved) {
      status = 'provisional-district';
      reasons.push(
        `District "${reportTarget.districtName ?? '(unknown)'}" is not a registered district (${districtConfidence}). Confirm/add it to the registry first.`
      );
    } else if (existingTeam === null) {
      status = 'no-existing-team';
      reasons.push(
        'No existing workspace team matches this season / district / age division / classification.'
      );
    } else if (previewPlan.status === 'planned') {
      if (claimedExistingTeamIds.has(existingTeam.teamId)) {
        status = 'duplicate-target';
        reasons.push(
          `Another target in this file already commits into team ${existingTeam.teamId}; skipped to avoid double-applying additions.`
        );
      } else {
        status = 'committable';
        committable = true;
      }
    } else {
      status = 'needs-review';
      if (previewPlan.status === 'rejected') {
        pushReasons(reasons, previewPlan.blockingReasons.map((r) => r.message));
      }
      pushReasons(reasons, reportTarget.readinessReasons);
    }

    targets.push({
      sourceTargetId,
      teamName: reportTarget.teamName,
      districtName: reportTarget.districtName,
      districtId: ctx?.districtId ?? reportTarget.canonicalDistrictId,
      districtResolved,
      ageDivisionId: ctx?.ageDivisionId ?? reportTarget.canonicalAgeDivisionId,
      ageDivisionLabel: reportTarget.ageDivisionLabel,
      teamClassification: ctx?.teamClassification ?? reportTarget.teamClassification,
      existingTeamId: review.available ? review.existingTeamId : null,
      status,
      committable,
      projectedAdditions: additions,
      linkNoOps: links,
      reasons,
    });

    if (committable && existingTeam) {
      claimedExistingTeamIds.add(existingTeam.teamId);
      committableTargets.push({
        sourceTargetId,
        existingTeam,
        source: artifactSource,
        target: artifactTarget,
        review,
        stagedProjection,
        readiness,
        projectedAdditions: additions,
      });
    }
  }

  const playerTargets = targets.filter((t) => t.status !== 'non-player');
  const committableCount = committableTargets.length;
  const countStatus = (s: WholeFileTargetStatus) =>
    targets.filter((t) => t.status === s).length;

  return {
    recordType,
    isPlayerFile,
    totalTargets: targets.length,
    playerTargetCount: playerTargets.length,
    coachTargetCount: countStatus('non-player'),
    committableCount,
    skippedCount: playerTargets.length - committableCount,
    emptyCount: countStatus('empty'),
    blockedCount: countStatus('blocked'),
    needsReviewCount: countStatus('needs-review'),
    noExistingTeamCount: countStatus('no-existing-team'),
    provisionalDistrictCount: countStatus('provisional-district'),
    duplicateTargetCount: countStatus('duplicate-target'),
    totalProjectedAdditions: committableTargets.reduce(
      (sum, t) => sum + t.projectedAdditions,
      0
    ),
    totalLinkNoOps: targets
      .filter((t) => t.committable)
      .reduce((sum, t) => sum + t.linkNoOps, 0),
    districtsResolvedCount: playerTargets.filter((t) => t.districtResolved).length,
    districtsProvisionalCount: playerTargets.filter((t) => !t.districtResolved).length,
    targets,
    committableTargets,
  };
}

function pushReasons(reasons: string[], messages: string[]): void {
  for (const message of messages) {
    if (message && !reasons.includes(message)) reasons.push(message);
  }
}

// ---------------------------------------------------------------------------
// Batch execution (all-or-nothing)
// ---------------------------------------------------------------------------

export type WholeFileBatchExecutedTeamSummary = {
  teamId: string;
  teamName: string | null;
  addedCount: number;
  beforeCount: number;
  afterCount: number;
};

export type WholeFileBatchExecutionResult =
  | {
      status: 'executed';
      /** New team values (existing records preserved + planned additions appended). */
      committedTeams: Team[];
      perTeam: WholeFileBatchExecutedTeamSummary[];
      teamsCommitted: number;
      totalAdded: number;
    }
  | {
      status: 'rejected';
      failedTargetId: string;
      reason: string;
      message: string;
    }
  | { status: 'nothing-to-commit' };

/**
 * Executes the committable targets into new in-memory team values, all-or-nothing. Pure;
 * never mutates inputs. On the first execution rejection, returns `rejected` and produces
 * NO committed teams, so the caller applies nothing and the workspace cannot be partially
 * corrupted. Returns `nothing-to-commit` for an empty committable list.
 */
export function executeWholeFilePlayerImportBatch(input: {
  committableTargets: WholeFileCommittableTarget[];
  /** Caller-supplied stable timestamp (keeps output deterministic). */
  generatedAt: string;
}): WholeFileBatchExecutionResult {
  const { committableTargets, generatedAt } = input;
  if (committableTargets.length === 0) return { status: 'nothing-to-commit' };

  const committedTeams: Team[] = [];
  const perTeam: WholeFileBatchExecutedTeamSummary[] = [];

  for (const t of committableTargets) {
    const transactionPlan = buildScrapedJsonImportTransactionPlan({
      transactionId: `whole-file-import:${t.sourceTargetId}:${generatedAt}`,
      generatedAt,
      source: t.source,
      target: t.target,
      review: t.review,
      stagedProjection: t.stagedProjection,
      readiness: t.readiness,
    });
    const result = executeUteConferenceScrapedJsonImportTransaction({
      transactionPlan,
      existingTeam: t.existingTeam,
      executedAt: generatedAt,
    });
    if (result.status !== 'executed') {
      return {
        status: 'rejected',
        failedTargetId: t.sourceTargetId,
        reason: result.reason,
        message: result.message,
      };
    }
    committedTeams.push(result.executedTeam);
    perTeam.push({
      teamId: result.executedTeam.teamId,
      teamName: t.target.teamName,
      addedCount: result.rosterDeltaSummary.addedCount,
      beforeCount: result.beforeRosterSummary.playerCount,
      afterCount: result.afterRosterSummary.playerCount,
    });
  }

  return {
    status: 'executed',
    committedTeams,
    perTeam,
    teamsCommitted: committedTeams.length,
    totalAdded: perTeam.reduce((sum, p) => sum + p.addedCount, 0),
  };
}
