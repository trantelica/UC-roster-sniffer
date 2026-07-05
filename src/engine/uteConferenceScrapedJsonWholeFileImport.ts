import type { Player, Team } from '../domain/types';
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
 * Whole-file scraped-JSON PLAYER import planning + commit — ENGINE ONLY, PURE.
 *
 * Corrected product model: a roster file may CREATE teams. Teams are season-specific and are
 * created from roster imports; districts are infrastructure (seeded or added provisionally,
 * never auto-invented here). For every player-team target this plans one ACTION:
 *
 *  - **create** — the district resolves to a registered district at HIGH confidence (C3), the
 *    season / age division / team classification all resolve, and NO matching team exists yet
 *    → a brand-new empty team is created and the source players are added exactly as written
 *    (no row-level identity review is needed for a brand-new empty team).
 *  - **update** — a matching team already exists → the existing single-target pipeline applies
 *    (roster-aware review → staged projection → readiness → transaction plan), with EMPTY
 *    review decisions, so existing rosters stay authoritative and match-bearing rows still
 *    require review (and are not committed in the batch).
 *  - **blocked** — anything that cannot be done safely: an unregistered/provisional district
 *    ("Add district first"), a team label whose classification can't be parsed, a parenthetical
 *    district reference that does not resolve to a known district (e.g. "GridIron A1 (Bonneville)"
 *    when Bonneville is unregistered — never collapsed into "A1" under the scraped district), a
 *    missing season/age division, an existing team that needs review, a duplicate target, an
 *    empty target, or a non-player target.
 *
 * Parenthetical district routing: a team label like "GridIron A1 (Layton)" is read as the team
 * "GridIron A1" / "A1" REPRESENTED under the Layton district (when Layton is registered), with
 * the scraped/admin district and original source label retained as source evidence. The team is
 * created/updated under the represented district — never as a literal "GridIron A1 (Layton)"
 * team under the scraped district.
 *
 * Guardrails: never mutates the payload, existing teams, or any input. Player names are placed
 * into new teams EXACTLY as provided (no trim/dedupe/merge/suppress). Commit is ALL-OR-NOTHING.
 * Caller-supplied `generatedAt` keeps execution output deterministic.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_WHOLE_FILE_IMPORT_LOGIC_VERSION =
  'roster-ingestion-create-or-update-v1';

export type WholeFileTargetAction = 'create' | 'update' | 'blocked';

export type WholeFileTargetStatus =
  | 'create'
  | 'update'
  | 'needs-review'
  | 'blocked'
  | 'empty'
  | 'provisional-district'
  | 'unresolved-parenthetical-district'
  | 'unparseable-team'
  | 'missing-context'
  | 'duplicate-target'
  | 'non-player';

/** One row of the whole-file summary table — render-ready, no business logic. */
export type WholeFileTargetSummary = {
  sourceTargetId: string;
  teamName: string | null;
  districtName: string | null;
  districtId: string | null;
  districtResolved: boolean;
  /** True when the team label routed to a represented district via a parenthetical (e.g. "(Layton)"). */
  routedFromParenthetical: boolean;
  /** The scraped/admin district the row appeared under when routed (source evidence), else null. */
  sourceDistrictName: string | null;
  /** The represented district candidate (parenthetical text) when routed, else null. */
  representedDistrictName: string | null;
  ageDivisionId: string | null;
  ageDivisionLabel: string | null;
  teamClassification: string | null;
  /** The id of the team this target would create or update, when known. */
  teamId: string | null;
  existingTeamId: string | null;
  action: WholeFileTargetAction;
  status: WholeFileTargetStatus;
  /** True when the target will be committed (create or update). */
  committable: boolean;
  /** Players to add (create: all source rows; update: projected new additions). */
  playerCount: number;
  reasons: string[];
};

/**
 * Execution inputs for one UPDATE target (existing team). Carried so the batch can build a
 * real transaction plan + execute it without re-deriving the pipeline.
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
  isPlayerFile: boolean;
  totalTargets: number;
  playerTargetCount: number;
  coachTargetCount: number;
  /** Number of brand-new teams to create. */
  createCount: number;
  /** Number of existing teams to update (committable). */
  committableCount: number;
  /** Blocked player targets (everything not create/update). */
  blockedCount: number;
  /** Total players across all create + update targets. */
  totalPlayersToImport: number;
  totalProjectedAdditions: number;
  districtsResolvedCount: number;
  districtsProvisionalCount: number;
  targets: WholeFileTargetSummary[];
  /** Fully-formed new team records (empty teams + their source players), in source order. */
  teamsToCreate: Team[];
  /** Execution inputs for the existing-team updates, in source order. */
  committableTargets: WholeFileCommittableTarget[];
};

export type BuildWholeFilePlayerImportPlanInput = {
  payload: unknown;
  existingTeams: Team[];
  districtRegistry?: Record<string, string>;
  sourceName?: string | null;
};

/** Players for a brand-new team: every source preview row's name, preserved exactly. */
function playersFromSession(
  rows: ReadonlyArray<{ playerName: string | null }>
): Player[] {
  return rows.map((row) => ({ name: row.playerName ?? '' }));
}

/**
 * Builds the whole-file player import plan (create / update / blocked per target). Pure; never
 * mutates inputs. Reuses the single-target pipeline for updates; builds empty team shells for
 * creates.
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
  const teamsToCreate: Team[] = [];
  const claimedExistingTeamIds = new Set<string>();
  // (season|district|age|code) -> running create order, for deterministic draftOrder.
  const claimedNewTeamIds = new Set<string>();

  for (const reportTarget of reportTargets) {
    const sourceTargetId = reportTarget.sourceTargetId;

    if (reportTarget.recordType !== 'players') {
      targets.push(
        baseSummary(reportTarget, {
          districtResolved: false,
          districtId: reportTarget.canonicalDistrictId,
          ageDivisionId: reportTarget.canonicalAgeDivisionId,
          teamClassification: reportTarget.teamClassification,
          teamId: null,
          existingTeamId: null,
          action: 'blocked',
          status: 'non-player',
          playerCount: 0,
          reasons: ['Coach/non-player target — not imported by player roster import.'],
        })
      );
      continue;
    }

    const session = selectUteScrapedJsonImportSessionTarget(baseSession, sourceTargetId);
    const mapping = session.selectedCanonicalContextMapping;
    const ctx = mapping?.canonicalContext ?? null;
    const districtConfidence = mapping?.district.confidence ?? 'unknown';
    const districtResolved = districtConfidence === 'high';
    const readinessStatus = session.selectedTarget?.readinessStatus ?? null;

    const review = buildScrapedJsonImportRosterAwareReview(session, input.existingTeams, {});
    const existingTeam = ctx
      ? findExistingRosterTeamForContext(input.existingTeams, {
          seasonId: ctx.seasonId,
          districtId: ctx.districtId,
          ageDivisionId: ctx.ageDivisionId,
          teamClassification: ctx.teamClassification,
        })
      : null;

    const routing = mapping?.parentheticalRouting ?? null;
    const common = {
      districtResolved,
      districtId: ctx?.districtId ?? reportTarget.canonicalDistrictId,
      ageDivisionId: ctx?.ageDivisionId ?? reportTarget.canonicalAgeDivisionId,
      teamClassification: ctx?.teamClassification ?? reportTarget.teamClassification,
      existingTeamId: review.available ? review.existingTeamId : null,
      routedFromParenthetical: routing !== null,
      sourceDistrictName: routing ? routing.sourceDistrictName : null,
      representedDistrictName: routing ? routing.representedDistrictCandidate : null,
    };
    // A source-trail note for routed (resolved) targets, so a routed team is never shown as if
    // it simply came from the represented district with no source evidence.
    const routingNote =
      routing && routing.resolved
        ? `Routed to ${routing.representedDistrictCandidate} from team label “${routing.originalTeamLabel}” (source district: ${routing.sourceDistrictName ?? '—'}).`
        : null;

    // --- Blocked-before-action gates ------------------------------------------------
    if (reportTarget.rowCount === 0) {
      targets.push(blockedSummary(reportTarget, common, 'empty', ['No rows to import.']));
      continue;
    }
    // An unresolved parenthetical district routes nowhere — block with a clear reason (never a
    // provisional slug under the scraped/admin district, and never a literal parenthetical team).
    if (routing && !routing.resolved) {
      targets.push(
        blockedSummary(reportTarget, common, 'unresolved-parenthetical-district', [
          `Team label “${routing.originalTeamLabel}” puts district “${routing.representedDistrictCandidate}” in parentheses, but that district is not in the registry. Add “${routing.representedDistrictCandidate}” first (Districts tab), then re-import.`,
        ])
      );
      continue;
    }
    if (readinessStatus === 'blocked') {
      targets.push(
        blockedSummary(reportTarget, common, 'blocked', reportTarget.readinessReasons)
      );
      continue;
    }
    if (!districtResolved) {
      targets.push(
        blockedSummary(reportTarget, common, 'provisional-district', [
          `District "${reportTarget.districtName ?? '(unknown)'}" is not in the registry. Add the district first (Districts tab, or “Add district to registry” after selecting this target), then re-import.`,
        ])
      );
      continue;
    }

    // --- Update an existing team -----------------------------------------------------
    if (existingTeam) {
      const stagedProjection = buildScrapedJsonImportStagedProjection(review, existingTeam);
      const readiness = buildScrapedJsonImportFutureCommitReadiness(review, stagedProjection);
      const artifactTarget = makeArtifactTarget(reportTarget, ctx, existingTeam.teamId);
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

      if (previewPlan.status !== 'planned') {
        const reasons =
          previewPlan.status === 'rejected'
            ? previewPlan.blockingReasons.map((r) => r.message)
            : [];
        targets.push(
          blockedSummary(reportTarget, common, 'needs-review', [
            ...reasons,
            ...reportTarget.readinessReasons,
          ])
        );
        continue;
      }
      if (claimedExistingTeamIds.has(existingTeam.teamId)) {
        targets.push(
          blockedSummary(reportTarget, common, 'duplicate-target', [
            `Another target already updates team ${existingTeam.teamId}; skipped to avoid double-applying.`,
          ])
        );
        continue;
      }
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
      targets.push({
        ...baseSummaryFields(reportTarget, common),
        teamId: existingTeam.teamId,
        action: 'update',
        status: 'update',
        committable: true,
        playerCount: additions,
        reasons: routingNote ? [routingNote] : [],
      });
      continue;
    }

    // --- Create a brand-new team -----------------------------------------------------
    if (ctx === null || ctx.seasonId === null || ctx.ageDivisionId === null) {
      targets.push(
        blockedSummary(reportTarget, common, 'missing-context', [
          'Could not resolve a season and/or age division for this target (name the file with a 4-digit year, e.g. “…-2026.json”).',
        ])
      );
      continue;
    }
    if (ctx.teamClassification === null || ctx.districtId === null) {
      targets.push(
        blockedSummary(reportTarget, common, 'unparseable-team', [
          `Could not read a team code from "${reportTarget.teamName ?? '(unnamed team)'}" (expected an explicit A1/B2/C1-style code). A parenthetical district (e.g. “… A1 (Layton)”) is read as a represented district, not a team code, and is never merged into a plain code.`,
        ])
      );
      continue;
    }

    const teamId = `${ctx.seasonId}-${ctx.districtId}-${ctx.ageDivisionId}-${ctx.teamClassification}`;
    if (claimedNewTeamIds.has(teamId)) {
      targets.push(
        blockedSummary(reportTarget, common, 'duplicate-target', [
          `Another target already creates team ${teamId}; skipped to avoid duplicate teams.`,
        ])
      );
      continue;
    }
    claimedNewTeamIds.add(teamId);

    const players = playersFromSession(session.selectedPlayerPreviewResult?.rows ?? []);
    teamsToCreate.push({
      teamId,
      seasonId: ctx.seasonId,
      districtId: ctx.districtId,
      ageDivisionId: ctx.ageDivisionId,
      teamCode: ctx.teamClassification,
      // draftOrder / divisionTeamCount are finalized below once all creates are known.
      draftOrder: 0,
      divisionTeamCount: 0,
      headCoach: null,
      assistantCoaches: [],
      players,
    });
    targets.push({
      ...baseSummaryFields(reportTarget, common),
      teamId,
      action: 'create',
      status: 'create',
      committable: true,
      playerCount: players.length,
      reasons: routingNote ? [routingNote] : [],
    });
  }

  finalizeCreatedTeamDraftOrders(teamsToCreate, input.existingTeams);

  const playerTargets = targets.filter((t) => t.status !== 'non-player');
  const createCount = teamsToCreate.length;
  const committableCount = committableTargets.length;
  const blockedCount = playerTargets.filter((t) => t.action === 'blocked').length;
  const totalCreatePlayers = teamsToCreate.reduce((sum, t) => sum + t.players.length, 0);
  const totalProjectedAdditions = committableTargets.reduce(
    (sum, t) => sum + t.projectedAdditions,
    0
  );

  return {
    recordType,
    isPlayerFile,
    totalTargets: targets.length,
    playerTargetCount: playerTargets.length,
    coachTargetCount: targets.filter((t) => t.status === 'non-player').length,
    createCount,
    committableCount,
    blockedCount,
    totalPlayersToImport: totalCreatePlayers + totalProjectedAdditions,
    totalProjectedAdditions,
    districtsResolvedCount: playerTargets.filter((t) => t.districtResolved).length,
    districtsProvisionalCount: playerTargets.filter((t) => !t.districtResolved).length,
    targets,
    teamsToCreate,
    committableTargets,
  };
}

/**
 * Assigns deterministic `draftOrder` / `divisionTeamCount` to created teams. For each
 * (season, district, age) division the count is the existing teams in that division plus the
 * teams created in this batch; created teams are ordered by team code and slotted after any
 * existing teams. Existing teams are never mutated.
 */
function finalizeCreatedTeamDraftOrders(created: Team[], existing: Team[]): void {
  const divisionKey = (t: Team) => `${t.seasonId}|${t.districtId}|${t.ageDivisionId}`;
  const existingByDivision = new Map<string, number>();
  for (const t of existing) {
    existingByDivision.set(divisionKey(t), (existingByDivision.get(divisionKey(t)) ?? 0) + 1);
  }
  const createdByDivision = new Map<string, Team[]>();
  for (const t of created) {
    const key = divisionKey(t);
    if (!createdByDivision.has(key)) createdByDivision.set(key, []);
    createdByDivision.get(key)!.push(t);
  }
  for (const [key, group] of createdByDivision) {
    const existingCount = existingByDivision.get(key) ?? 0;
    const total = existingCount + group.length;
    const ordered = [...group].sort((a, b) =>
      a.teamCode < b.teamCode ? -1 : a.teamCode > b.teamCode ? 1 : 0
    );
    ordered.forEach((team, index) => {
      team.divisionTeamCount = total;
      team.draftOrder = existingCount + index + 1;
    });
  }
}

function makeArtifactTarget(
  reportTarget: { teamName: string | null },
  ctx: {
    seasonId: string | null;
    districtId: string | null;
    ageDivisionId: string | null;
    teamClassification: string | null;
  } | null,
  existingTeamId: string | null
): ScrapedImportPreviewArtifactTarget {
  return {
    teamName: reportTarget.teamName,
    existingTeamId,
    seasonId: ctx?.seasonId ?? null,
    districtId: ctx?.districtId ?? null,
    ageDivisionId: ctx?.ageDivisionId ?? null,
    teamClassification: ctx?.teamClassification ?? null,
  };
}

type CommonSummaryFields = {
  districtResolved: boolean;
  districtId: string | null;
  ageDivisionId: string | null;
  teamClassification: string | null;
  existingTeamId: string | null;
  routedFromParenthetical: boolean;
  sourceDistrictName: string | null;
  representedDistrictName: string | null;
};

function baseSummaryFields(
  reportTarget: {
    sourceTargetId: string;
    teamName: string | null;
    districtName: string | null;
    ageDivisionLabel: string | null;
  },
  common: CommonSummaryFields
): Omit<WholeFileTargetSummary, 'teamId' | 'action' | 'status' | 'committable' | 'playerCount' | 'reasons'> {
  return {
    sourceTargetId: reportTarget.sourceTargetId,
    teamName: reportTarget.teamName,
    districtName: reportTarget.districtName,
    districtId: common.districtId,
    districtResolved: common.districtResolved,
    routedFromParenthetical: common.routedFromParenthetical,
    sourceDistrictName: common.sourceDistrictName,
    representedDistrictName: common.representedDistrictName,
    ageDivisionId: common.ageDivisionId,
    ageDivisionLabel: reportTarget.ageDivisionLabel,
    teamClassification: common.teamClassification,
    existingTeamId: common.existingTeamId,
  };
}

function baseSummary(
  reportTarget: {
    sourceTargetId: string;
    teamName: string | null;
    districtName: string | null;
    ageDivisionLabel: string | null;
  },
  rest: Pick<
    WholeFileTargetSummary,
    | 'districtResolved'
    | 'districtId'
    | 'ageDivisionId'
    | 'teamClassification'
    | 'teamId'
    | 'existingTeamId'
    | 'action'
    | 'status'
    | 'playerCount'
    | 'reasons'
  >
): WholeFileTargetSummary {
  return {
    sourceTargetId: reportTarget.sourceTargetId,
    teamName: reportTarget.teamName,
    districtName: reportTarget.districtName,
    ageDivisionLabel: reportTarget.ageDivisionLabel,
    routedFromParenthetical: false,
    sourceDistrictName: null,
    representedDistrictName: null,
    committable: rest.action !== 'blocked',
    ...rest,
  };
}

function blockedSummary(
  reportTarget: {
    sourceTargetId: string;
    teamName: string | null;
    districtName: string | null;
    ageDivisionLabel: string | null;
  },
  common: CommonSummaryFields,
  status: WholeFileTargetStatus,
  reasons: string[]
): WholeFileTargetSummary {
  return {
    ...baseSummaryFields(reportTarget, common),
    teamId: null,
    action: 'blocked',
    status,
    committable: false,
    playerCount: 0,
    reasons: dedupeReasons(reasons),
  };
}

function dedupeReasons(messages: string[]): string[] {
  const out: string[] = [];
  for (const message of messages) {
    if (message && !out.includes(message)) out.push(message);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Update-target batch execution (all-or-nothing) — existing teams only
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
      committedTeams: Team[];
      perTeam: WholeFileBatchExecutedTeamSummary[];
      teamsCommitted: number;
      totalAdded: number;
    }
  | { status: 'rejected'; failedTargetId: string; reason: string; message: string }
  | { status: 'nothing-to-commit' };

/**
 * Executes the UPDATE targets into new in-memory team values, all-or-nothing. Pure. On the
 * first rejection, returns `rejected` and produces NO committed teams. Returns
 * `nothing-to-commit` for an empty list (e.g. a create-only import).
 */
export function executeWholeFilePlayerImportBatch(input: {
  committableTargets: WholeFileCommittableTarget[];
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
