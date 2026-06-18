import type { Team } from '../domain/types';
import { createRosterImportPreviewIdentityMatches } from './rosterImportPreviewIdentityMatch';
import type {
  ExistingRosterIdentityRecord,
  RosterImportPreviewIdentityMatchEntry,
  RosterImportPreviewIdentityMatchConfidence,
} from './rosterImportPreviewIdentityMatch';
import {
  applyRosterImportIdentityReviewAction,
  createRosterImportIdentityReviewDecision,
} from './rosterImportIdentityReviewDecision';
import type {
  RosterImportIdentityReviewActionType,
  RosterImportIdentityReviewDecision,
} from './rosterImportIdentityReviewDecision';
import { applyRosterImportIdentityReviewDecisionsToMatches } from './rosterImportIdentityReviewDecisionApplication';
import { createRosterImportCommitPreviewPlan } from './rosterImportCommitPreviewPlan';
import type { RosterImportCommitPreviewPlanStatus } from './rosterImportCommitPreviewPlan';
import { createRosterImportApplicationProjection } from './rosterImportApplicationProjection';
import type { ExistingRosterProjectionRecord } from './rosterImportApplicationProjection';
import type { UteScrapedJsonImportSession } from './uteConferenceScrapedJsonImportSession';

/**
 * Phase 5 slice 18: PURE, deterministic ROSTER-AWARE import review + decision-aware
 * dry-run for a selected scraped JSON target — ENGINE ONLY.
 *
 * It answers: "for the selected player target, how do the imported preview rows compare
 * against the EXISTING local roster for that context, and — given the reviewer's
 * in-memory decisions — what would a deterministic import dry-run produce?"
 *
 * It COMPOSES the existing Phase 5 helpers end to end and duplicates none of their
 * logic: slice 2 identity matching against the existing roster, slice 3 review
 * actions/decisions, slice 5 decision application, slice 6 commit-preview plan, and
 * slice 8 application projection. Slice 4's append-only decision repository is
 * intentionally not used — the reviewer's choices are a simple per-row in-memory map
 * resolved fresh on every call, so no decision history / supersession is needed.
 *
 * Guardrails: this is PREVIEW + PROJECTION ONLY. Nothing is applied, committed,
 * written, linked, created, merged, persisted, or mutated. The session, payload,
 * preview rows, existing roster, and prior seasons are never mutated. Raw imported and
 * existing player names are preserved exactly. Readiness is never bypassed and a
 * high-confidence single candidate is NEVER auto-linked — a match-bearing row stays
 * `unresolved` (and blocks a clean dry-run) until the reviewer decides. Only an
 * unambiguous no-match row defaults to a projected create. If the existing roster
 * context cannot be located, a deterministic unavailable state is returned rather than
 * pretending every row is new. Decision ids derive from stable preview-row keys and
 * timestamps are fixed sentinels, so output is identical across repeated calls.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_IMPORT_ROSTER_AWARE_REVIEW_LOGIC_VERSION =
  'phase5-slice18-scraped-json-import-roster-aware-review-v1';

/** Per-row identity classification surfaced to the UI. */
export type ScrapedImportIdentityMatchStatus =
  | 'likely-new'
  | 'likely-existing'
  | 'ambiguous'
  | 'needs-review'
  | 'blocked';

/** A reviewer's in-memory decision kind for one imported player row. */
export type ScrapedImportReviewDecisionKind =
  | 'confirm-match'
  | 'create-new'
  | 'needs-review';

/** In-memory per-row decisions, keyed by preview source row id. */
export type ScrapedImportReviewDecisionMap = Record<
  string,
  ScrapedImportReviewDecisionKind
>;

export type ScrapedImportReviewUnavailableReason =
  | 'no-selection'
  | 'coach-target-not-projectable'
  | 'target-blocked'
  | 'target-empty'
  | 'no-player-preview'
  | 'missing-target-context'
  | 'missing-existing-roster-context';

export type ScrapedImportReviewCandidate = {
  existingRecordId: string;
  existingPlayerName: string | null;
  confidence: RosterImportPreviewIdentityMatchConfidence;
};

/** The effective dry-run outcome for one row, after decisions are applied. */
export type ScrapedImportReviewRowOutcome =
  | 'projected-create'
  | 'projected-link'
  | 'deferred'
  | 'blocked-unresolved'
  | 'blocked';

export type ScrapedImportReviewRow = {
  sourceRowId: string | null;
  rowIndex: number;
  /** Raw imported player name, preserved exactly. */
  playerName: string | null;
  matchStatus: ScrapedImportIdentityMatchStatus;
  candidates: ScrapedImportReviewCandidate[];
  /** True when exactly one candidate exists, so "confirm match" is meaningful. */
  confirmable: boolean;
  /** The reviewer's current decision for this row, or null (derived/unresolved). */
  decision: ScrapedImportReviewDecisionKind | null;
  outcome: ScrapedImportReviewRowOutcome;
  /** The slice 6 commit-plan status this row resolves to under current decisions. */
  planStatus: RosterImportCommitPreviewPlanStatus;
  /** The existing record id a confirmed match would link to, or null. */
  linkTargetExistingRecordId: string | null;
  /** The existing record a confirmed match would link to (raw name preserved). */
  linkTargetExistingName: string | null;
  /** The raw name a projected create would add (provisional; never written). */
  projectedNewPlayerName: string | null;
};

export type ScrapedImportReviewSummary = {
  totalRows: number;
  likelyNew: number;
  likelyExisting: number;
  ambiguous: number;
  needsReview: number;
  blocked: number;
  projectedCreateRows: number;
  projectedLinkRows: number;
  deferredRows: number;
  unresolvedRows: number;
  /** True only when the dry-run plan is fully committable (no unresolved/blocked rows). */
  canCommit: boolean;
};

export type ScrapedImportRosterAwareReview =
  | {
      available: false;
      reason: ScrapedImportReviewUnavailableReason;
      message: string;
    }
  | {
      available: true;
      existingTeamId: string;
      existingPlayerCount: number;
      rows: ScrapedImportReviewRow[];
      summary: ScrapedImportReviewSummary;
    };

const UNAVAILABLE_MESSAGES: Record<ScrapedImportReviewUnavailableReason, string> = {
  'no-selection': 'Select a player target to compare against the existing roster.',
  'coach-target-not-projectable':
    'Coach targets do not have player identity review.',
  'target-blocked': 'This target is blocked, so roster-aware review is not available.',
  'target-empty': 'This target has no rows to review.',
  'no-player-preview': 'This target has no player preview rows to review.',
  'missing-target-context':
    'The target is missing canonical season / district / age-division / team context.',
  'missing-existing-roster-context':
    'No existing roster was found for this season, district, age division, and team, so imported rows cannot be compared. Roster-aware review is unavailable.',
};

function unavailable(
  reason: ScrapedImportReviewUnavailableReason
): ScrapedImportRosterAwareReview {
  return { available: false, reason, message: UNAVAILABLE_MESSAGES[reason] };
}

/**
 * Locates the existing roster team for a scraped canonical context by decomposed
 * fields (season + district + age division + team code/classification). The scraped
 * `teamId` is not used directly because its casing differs from the static team ids.
 */
export function findExistingRosterTeamForContext(
  teams: Team[],
  context: {
    seasonId: string | null;
    districtId: string | null;
    ageDivisionId: string | null;
    teamClassification: string | null;
  }
): Team | null {
  const { seasonId, districtId, ageDivisionId, teamClassification } = context;
  if (
    seasonId === null ||
    districtId === null ||
    ageDivisionId === null ||
    teamClassification === null
  ) {
    return null;
  }
  return (
    teams.find(
      (team) =>
        team.seasonId === seasonId &&
        team.districtId === districtId &&
        team.ageDivisionId === ageDivisionId &&
        team.teamCode === teamClassification
    ) ?? null
  );
}

/** Builds existing-roster identity records from a team. Raw names preserved exactly. */
function existingRecordsForTeam(team: Team): ExistingRosterIdentityRecord[] {
  return team.players.map((player, index) => ({
    recordId: `${team.teamId}#${index}`,
    seasonId: team.seasonId,
    districtId: team.districtId,
    ageDivisionId: team.ageDivisionId,
    teamId: team.teamId,
    playerName: player.name,
  }));
}

function classifyEntry(
  entry: RosterImportPreviewIdentityMatchEntry
): ScrapedImportIdentityMatchStatus {
  if (
    entry.status === 'skipped-invalid-preview-row' ||
    entry.status === 'skipped-review-preview-row'
  ) {
    return 'blocked';
  }
  if (entry.status === 'multiple-candidates') return 'ambiguous';
  const hasWarning = entry.issues.some((i) => i.severity !== 'info');
  if (hasWarning) return 'needs-review';
  if (entry.status === 'single-candidate') return 'likely-existing';
  return 'likely-new';
}

/**
 * Derives the canonical review action for an entry from the reviewer's in-memory
 * decision, falling back to a derived default. Returns null when the row should stay
 * unresolved (no decision applied).
 */
function actionForEntry(
  entry: RosterImportPreviewIdentityMatchEntry,
  decision: ScrapedImportReviewDecisionKind | undefined,
  matchStatus: ScrapedImportIdentityMatchStatus
): { action: RosterImportIdentityReviewActionType; selectedExistingRecordId?: string } | null {
  if (decision === 'create-new') return { action: 'create-new' };
  if (decision === 'needs-review') return { action: 'defer' };
  if (decision === 'confirm-match') {
    // Confirm is only meaningful with exactly one candidate.
    if (entry.candidates.length === 1) {
      return {
        action: 'accept-candidate',
        selectedExistingRecordId: entry.candidates[0].existingRecordId,
      };
    }
    return null;
  }
  // No reviewer decision: only an unambiguous no-match row defaults to create-new.
  if (matchStatus === 'likely-new') return { action: 'create-new' };
  return null;
}

function outcomeFromPlanStatus(
  status: RosterImportCommitPreviewPlanStatus
): ScrapedImportReviewRowOutcome {
  switch (status) {
    case 'ready-to-create':
      return 'projected-create';
    case 'ready-to-link':
      return 'projected-link';
    case 'deferred':
      return 'deferred';
    case 'blocked-unresolved':
      return 'blocked-unresolved';
    default:
      return 'blocked';
  }
}

/**
 * Builds the roster-aware review + decision-aware dry-run for a session's selected
 * target. Pure; never mutates the session, payload, preview rows, or existing teams.
 */
export function buildScrapedJsonImportRosterAwareReview(
  session: UteScrapedJsonImportSession,
  existingTeams: Team[],
  decisions: ScrapedImportReviewDecisionMap = {}
): ScrapedImportRosterAwareReview {
  const selected = session.selectedTarget;
  if (!selected) return unavailable('no-selection');
  if (selected.recordType !== 'players') {
    return unavailable('coach-target-not-projectable');
  }
  if (selected.readinessStatus === 'blocked') return unavailable('target-blocked');
  if (selected.readinessStatus === 'empty') return unavailable('target-empty');

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

  const existingTeam = findExistingRosterTeamForContext(existingTeams, {
    seasonId: ctx.seasonId,
    districtId: ctx.districtId,
    ageDivisionId: ctx.ageDivisionId,
    teamClassification: ctx.teamClassification,
  });
  if (!existingTeam) return unavailable('missing-existing-roster-context');

  const existingRecords = existingRecordsForTeam(existingTeam);
  const existingNameByRecordId = new Map(
    existingRecords.map((r) => [r.recordId, r.playerName])
  );

  const matches = createRosterImportPreviewIdentityMatches({
    previewRows,
    existingRosterRecords: existingRecords,
  });

  // Build canonical review decisions (reviewer choice or derived default) per entry.
  const matchStatusByKey = new Map<string, ScrapedImportIdentityMatchStatus>();
  const reviewDecisions: RosterImportIdentityReviewDecision[] = [];
  for (const entry of matches.entries) {
    const matchStatus = classifyEntry(entry);
    if (entry.previewSourceRowId !== null) {
      matchStatusByKey.set(entry.previewSourceRowId, matchStatus);
    }
    const userDecision =
      entry.previewSourceRowId !== null ? decisions[entry.previewSourceRowId] : undefined;
    const resolved = actionForEntry(entry, userDecision, matchStatus);
    if (!resolved) continue;
    const actionResult = applyRosterImportIdentityReviewAction(entry, {
      action: resolved.action,
      selectedExistingRecordId: resolved.selectedExistingRecordId,
    });
    const created = createRosterImportIdentityReviewDecision(actionResult, {
      decisionId: `slice18:${entry.previewSourceRowId}:${entry.previewRowIndex}`,
      createdAt: 'in-memory-review',
      reviewedAt: 'in-memory-review',
    });
    if (created.created && created.decision) reviewDecisions.push(created.decision);
  }

  const applied = applyRosterImportIdentityReviewDecisionsToMatches(
    matches.entries,
    reviewDecisions
  );
  const targetContext = {
    seasonId: ctx.seasonId,
    districtId: ctx.districtId,
    ageDivisionId: ctx.ageDivisionId,
    teamId: ctx.teamId,
  };
  const plan = createRosterImportCommitPreviewPlan({
    appliedEntries: applied.entries,
    targetContext,
  });
  // The slice 8 application projection is composed for the COMMITTABLE case (it gates
  // on plan.canCommit and yields provisional new-record / validated-link details). Per
  // row, the slice 6 plan is the source of truth because it represents partial / mixed
  // decision states (some rows resolved, some still unresolved) without gating.
  const projection = createRosterImportApplicationProjection({
    plan,
    existingRosterRecords: existingRecords as ExistingRosterProjectionRecord[],
  });
  const projectedNewNameByKey = new Map(
    projection.rows.map((row) => [
      `${row.previewSourceRowId}:${row.previewRowIndex}`,
      row.projectedNewRecord?.playerName ?? null,
    ])
  );
  const planRowByKey = new Map(
    plan.rows.map((row) => [`${row.previewSourceRowId}:${row.previewRowIndex}`, row])
  );

  const rows: ScrapedImportReviewRow[] = matches.entries.map((entry) => {
    const key = `${entry.previewSourceRowId}:${entry.previewRowIndex}`;
    const matchStatus =
      (entry.previewSourceRowId !== null
        ? matchStatusByKey.get(entry.previewSourceRowId)
        : undefined) ?? classifyEntry(entry);
    const planRow = planRowByKey.get(key) ?? null;
    const planStatus: RosterImportCommitPreviewPlanStatus =
      planRow?.planStatus ?? 'blocked-unresolved';
    const userDecision =
      entry.previewSourceRowId !== null ? decisions[entry.previewSourceRowId] ?? null : null;
    const linkTargetExistingName =
      planRow?.targetExistingRecordId != null
        ? existingNameByRecordId.get(planRow.targetExistingRecordId) ?? null
        : null;
    const projectedNewPlayerName =
      planStatus === 'ready-to-create'
        ? projectedNewNameByKey.get(key) ?? entry.previewPlayerName
        : null;
    return {
      sourceRowId: entry.previewSourceRowId,
      rowIndex: entry.previewRowIndex,
      playerName: entry.previewPlayerName,
      matchStatus,
      candidates: entry.candidates.map((c) => ({
        existingRecordId: c.existingRecordId,
        existingPlayerName: c.existingPlayerName,
        confidence: c.confidence,
      })),
      confirmable: entry.candidates.length === 1,
      decision: userDecision,
      outcome: outcomeFromPlanStatus(planStatus),
      planStatus,
      linkTargetExistingRecordId: planRow?.targetExistingRecordId ?? null,
      linkTargetExistingName,
      projectedNewPlayerName,
    };
  });

  const summary: ScrapedImportReviewSummary = {
    totalRows: rows.length,
    likelyNew: rows.filter((r) => r.matchStatus === 'likely-new').length,
    likelyExisting: rows.filter((r) => r.matchStatus === 'likely-existing').length,
    ambiguous: rows.filter((r) => r.matchStatus === 'ambiguous').length,
    needsReview: rows.filter((r) => r.matchStatus === 'needs-review').length,
    blocked: rows.filter((r) => r.matchStatus === 'blocked').length,
    projectedCreateRows: rows.filter((r) => r.outcome === 'projected-create').length,
    projectedLinkRows: rows.filter((r) => r.outcome === 'projected-link').length,
    deferredRows: rows.filter((r) => r.outcome === 'deferred').length,
    unresolvedRows: rows.filter((r) => r.outcome === 'blocked-unresolved').length,
    canCommit: plan.canCommit && projection.ok,
  };

  return {
    available: true,
    existingTeamId: existingTeam.teamId,
    existingPlayerCount: existingTeam.players.length,
    rows,
    summary,
  };
}
