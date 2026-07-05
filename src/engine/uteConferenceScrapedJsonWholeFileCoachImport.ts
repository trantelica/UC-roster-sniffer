import type { Coach, Team } from '../domain/types';
import {
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
} from './uteConferenceScrapedJsonImportSession';
import type { UteScrapedRecordType } from './uteConferenceScrapedJsonAdapter';
import { createCoachImportPreviewInputFromScrapedJson } from './uteConferenceScrapedJsonAdapter';
import type { UteCoachImportPreviewRow } from './uteConferenceScrapedJsonAdapter';
import { findExistingRosterTeamForContext } from './uteConferenceScrapedJsonImportRosterAwareReview';
import { finalizeCreatedTeamDraftOrders } from './uteConferenceScrapedJsonWholeFileImport';
import { interpretScrapedCoachTitle } from './scrapedCoachTitleRole';
import {
  commitRosterImportToWorkspace,
  undoRosterImportInWorkspace,
} from './workspaceImportCommit';
import type {
  WorkspaceRosterImportUndoResult,
} from './workspaceImportCommit';
import type { WorkspaceData } from './workspaceSnapshot';

/**
 * Whole-file scraped-JSON COACH import planning + commit — ENGINE ONLY, PURE.
 *
 * A committed coach source is authoritative evidence that a team exists for that season, so a
 * coach file may CREATE a season-specific team (with zero players) or UPDATE an existing team's
 * coaching-staff fields ONLY. It reuses the player pipeline end to end — source normalization,
 * team-target enumeration, canonical season/district/age/classification mapping, PR #73
 * parenthetical district routing, district-registry resolution, empty-workspace team creation,
 * and the shared roster-import commit/undo transform — rather than a parallel architecture.
 *
 * Per player-team target this plans one ACTION:
 *  - **create** — the district resolves at HIGH confidence, season/age/classification resolve,
 *    the coaching roles are safe, and NO matching team exists yet → a brand-new coach-only team
 *    (zero players) is created with the imported head coach + assistant coaches, exactly named.
 *  - **update** — a matching team already exists → its `headCoach`/`assistantCoaches` are
 *    REPLACED by the source staff; players, ids, draft-order, games, and every other field are
 *    preserved exactly.
 *  - **blocked** — anything unsafe: an unregistered/provisional district, an unresolved
 *    parenthetical district (PR #73), an unreadable team code, a missing season/age, a coach row
 *    with no name, a title whose role can't be represented, MULTIPLE distinct head coaches, or a
 *    duplicate/colliding target. A blocked target is reported (never silently dropped) and — per
 *    the coach-import rule — REFUSES the whole-file commit until resolved.
 *  - **empty** — a target with zero coach rows: nothing to import, and it does NOT block commit.
 *
 * Field authority: coach import is authoritative for coaching-staff fields ONLY. It never
 * touches players, games, schedules, districts, or unrelated team fields. Coach names are placed
 * EXACTLY as provided (no trim/dedupe/merge/suppress); assistant order follows source order and
 * duplicate assistant names are preserved. Raw source titles are retained in the plan metadata
 * (`staff[].rawTitle`); the durable `Team` contract is NOT extended to store titles.
 *
 * Guardrails: never mutates the payload, existing teams, or any input. Preview computes a plan
 * only — nothing is written until an explicit commit. Commit is ALL-OR-NOTHING and undoable for
 * the session (via the shared roster-import commit/undo).
 */

export const UTE_CONFERENCE_SCRAPED_JSON_WHOLE_FILE_COACH_IMPORT_LOGIC_VERSION =
  'coach-ingestion-create-or-update-v1';

export type WholeFileCoachTargetAction = 'create' | 'update' | 'blocked';

export type WholeFileCoachTargetStatus =
  | 'create'
  | 'update'
  | 'blocked'
  | 'empty'
  | 'provisional-district'
  | 'unresolved-parenthetical-district'
  | 'unparseable-team'
  | 'missing-context'
  | 'duplicate-target';

/** One source coach row, with the raw title preserved as evidence and the interpreted role. */
export type WholeFileCoachStaffMember = {
  /** Raw source coach name, preserved EXACTLY. */
  name: string;
  /** Raw source title, preserved EXACTLY (evidence); null when the source had none. */
  rawTitle: string | null;
  /** The interpreted roster role (`head` / `assistant` / `unrecognized`). */
  role: ReturnType<typeof interpretScrapedCoachTitle>;
};

/** One row of the whole-file coach summary table — render-ready, no business logic. */
export type WholeFileCoachTargetSummary = {
  sourceTargetId: string;
  teamName: string | null;
  districtName: string | null;
  districtId: string | null;
  districtResolved: boolean;
  routedFromParenthetical: boolean;
  sourceDistrictName: string | null;
  representedDistrictName: string | null;
  ageDivisionId: string | null;
  ageDivisionLabel: string | null;
  teamClassification: string | null;
  teamId: string | null;
  existingTeamId: string | null;
  action: WholeFileCoachTargetAction;
  status: WholeFileCoachTargetStatus;
  committable: boolean;
  /** Total source coach rows for the target. */
  coachCount: number;
  /** The recognized head coach name (exact), or null. */
  headCoachName: string | null;
  /** Recognized assistant coach names, in source order (duplicates preserved). */
  assistantCoachNames: string[];
  /** Every source coach row with its raw title + interpreted role (evidence). */
  staff: WholeFileCoachStaffMember[];
  reasons: string[];
};

export type WholeFileCoachImportPlan = {
  recordType: UteScrapedRecordType;
  isCoachFile: boolean;
  totalTargets: number;
  coachTargetCount: number;
  createCount: number;
  updateCount: number;
  /** Real blocks (action `blocked`, excluding `empty`). */
  blockedCount: number;
  emptyCount: number;
  /** Head + assistant coaches across all create + update targets. */
  totalCoachingStaff: number;
  districtsResolvedCount: number;
  districtsProvisionalCount: number;
  /** True only when there are create/update targets and NO blocked target. */
  canCommit: boolean;
  targets: WholeFileCoachTargetSummary[];
  /** Fully-formed new coach-only team records (zero players), in source order. */
  teamsToCreate: Team[];
  /** Existing teams with coaching fields REPLACED (all other fields preserved), in source order. */
  teamsToUpdate: Team[];
};

export type BuildWholeFileCoachImportPlanInput = {
  payload: unknown;
  existingTeams: Team[];
  districtRegistry?: Record<string, string>;
  sourceName?: string | null;
};

// ---------------------------------------------------------------------------
// Role resolution
// ---------------------------------------------------------------------------

type CoachRoleResolution =
  | {
      ok: true;
      headCoach: Coach | null;
      assistantCoaches: Coach[];
      staff: WholeFileCoachStaffMember[];
    }
  | { ok: false; reasons: string[]; staff: WholeFileCoachStaffMember[] };

/**
 * Resolves the source coach rows for one target into roster-embedded coaching fields. Names are
 * preserved EXACTLY; assistant order follows source order and duplicates are kept. Blocks (never
 * discards) when a row has no name, a title's role is unrecognized/ambiguous, or the target has
 * MORE THAN ONE distinct head coach. Pure.
 */
function resolveCoachRoles(rows: UteCoachImportPreviewRow[]): CoachRoleResolution {
  const staff: WholeFileCoachStaffMember[] = rows.map((row) => ({
    name: row.rawName ?? '',
    rawTitle: row.rawTitle,
    role: interpretScrapedCoachTitle(row.rawTitle),
  }));

  const reasons: string[] = [];
  const headNames: string[] = [];
  const assistantCoaches: Coach[] = [];

  rows.forEach((row, index) => {
    const name = row.rawName;
    if (name === null || name.trim() === '') {
      reasons.push(
        `Coach row ${index + 1} has no name; the target is blocked so no coach is discarded.`
      );
      return;
    }
    const role = interpretScrapedCoachTitle(row.rawTitle);
    if (role === 'head') {
      headNames.push(name);
    } else if (role === 'assistant') {
      assistantCoaches.push({ name });
    } else {
      reasons.push(
        `Coach "${name}" has an unrecognized role${
          row.rawTitle ? ` ("${row.rawTitle}")` : ' (no title)'
        }; only Head Coach / Asst Coach are supported, so the target is blocked rather than dropping the coach.`
      );
    }
  });

  // More than one DISTINCT head coach cannot be represented by the single `headCoach` slot.
  const distinctHeadNames = [...new Set(headNames)];
  if (distinctHeadNames.length > 1) {
    reasons.push(
      `Multiple different head coaches (${distinctHeadNames
        .map((n) => `"${n}"`)
        .join(', ')}); the target is blocked so no coach is lost.`
    );
  }

  if (reasons.length > 0) return { ok: false, reasons, staff };

  const headCoach: Coach | null = headNames.length > 0 ? { name: headNames[0] } : null;
  return { ok: true, headCoach, assistantCoaches, staff };
}

function countStaff(headCoach: Coach | null, assistantCoaches: Coach[]): number {
  return (headCoach ? 1 : 0) + assistantCoaches.length;
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

/**
 * Builds the whole-file coach import plan (create / update / blocked / empty per target). Pure;
 * never mutates inputs. Reuses the session + canonical mapping (incl. parenthetical routing) for
 * context; builds coach-only team shells for creates and coaching-field replacements for updates.
 */
export function buildWholeFileCoachImportPlan(
  input: BuildWholeFileCoachImportPlanInput
): WholeFileCoachImportPlan {
  const baseSession = createUteScrapedJsonImportSessionFromPayload(input.payload, {
    districtRegistry: input.districtRegistry,
  });
  const recordType = baseSession.recordType;
  const isCoachFile = recordType === 'coaches';

  const report = baseSession.readinessReport;
  const reportTargets = isCoachFile && report ? report.targets : [];

  const targets: WholeFileCoachTargetSummary[] = [];
  const teamsToCreate: Team[] = [];
  const teamsToUpdate: Team[] = [];
  const claimedExistingTeamIds = new Set<string>();
  const claimedNewTeamIds = new Set<string>();

  for (const reportTarget of reportTargets) {
    if (reportTarget.recordType !== 'coaches') continue;
    const sourceTargetId = reportTarget.sourceTargetId;

    const session = selectUteScrapedJsonImportSessionTarget(baseSession, sourceTargetId);
    const mapping = session.selectedCanonicalContextMapping;
    const ctx = mapping?.canonicalContext ?? null;
    const routing = mapping?.parentheticalRouting ?? null;
    const districtConfidence = mapping?.district.confidence ?? 'unknown';
    const districtResolved = districtConfidence === 'high';
    const readinessStatus = session.selectedTarget?.readinessStatus ?? null;

    const coachPreview = createCoachImportPreviewInputFromScrapedJson(input.payload, sourceTargetId);
    const existingTeam = ctx
      ? findExistingRosterTeamForContext(input.existingTeams, {
          seasonId: ctx.seasonId,
          districtId: ctx.districtId,
          ageDivisionId: ctx.ageDivisionId,
          teamClassification: ctx.teamClassification,
        })
      : null;

    const common: CommonCoachFields = {
      districtResolved,
      districtId: ctx?.districtId ?? reportTarget.canonicalDistrictId,
      ageDivisionId: ctx?.ageDivisionId ?? reportTarget.canonicalAgeDivisionId,
      teamClassification: ctx?.teamClassification ?? reportTarget.teamClassification,
      existingTeamId: existingTeam?.teamId ?? null,
      routedFromParenthetical: routing !== null,
      sourceDistrictName: routing ? routing.sourceDistrictName : null,
      representedDistrictName: routing ? routing.representedDistrictCandidate : null,
    };
    const routingNote =
      routing && routing.resolved
        ? `Routed to ${routing.representedDistrictCandidate} from team label “${routing.originalTeamLabel}” (source district: ${routing.sourceDistrictName ?? '—'}).`
        : null;

    // --- Blocked-before-action gates ------------------------------------------------
    if (reportTarget.rowCount === 0) {
      targets.push(blockedCoachSummary(reportTarget, common, 'empty', 0, [], ['No coaches to import.']));
      continue;
    }
    if (routing && !routing.resolved) {
      targets.push(
        blockedCoachSummary(reportTarget, common, 'unresolved-parenthetical-district', reportTarget.rowCount, [], [
          `Team label “${routing.originalTeamLabel}” puts district “${routing.representedDistrictCandidate}” in parentheses, but that district is not in the registry. Add “${routing.representedDistrictCandidate}” first (Districts tab), then re-import.`,
        ])
      );
      continue;
    }
    if (readinessStatus === 'blocked') {
      targets.push(
        blockedCoachSummary(reportTarget, common, 'blocked', reportTarget.rowCount, [], reportTarget.readinessReasons)
      );
      continue;
    }
    if (!districtResolved) {
      targets.push(
        blockedCoachSummary(reportTarget, common, 'provisional-district', reportTarget.rowCount, [], [
          `District "${reportTarget.districtName ?? '(unknown)'}" is not in the registry. Add the district first (Districts tab, or “Add district to registry” after selecting this target), then re-import.`,
        ])
      );
      continue;
    }
    if (ctx === null || ctx.seasonId === null || ctx.ageDivisionId === null) {
      targets.push(
        blockedCoachSummary(reportTarget, common, 'missing-context', reportTarget.rowCount, [], [
          'Could not resolve a season and/or age division for this target (name the file with a 4-digit year, e.g. “…-2026.json”).',
        ])
      );
      continue;
    }
    if (ctx.teamClassification === null || ctx.districtId === null) {
      targets.push(
        blockedCoachSummary(reportTarget, common, 'unparseable-team', reportTarget.rowCount, [], [
          `Could not read a team code from "${reportTarget.teamName ?? '(unnamed team)'}" (expected an explicit A1/B2/C1-style code).`,
        ])
      );
      continue;
    }

    // --- Coach role resolution ------------------------------------------------------
    const resolution = resolveCoachRoles(coachPreview.rows);
    if (!resolution.ok) {
      targets.push(
        blockedCoachSummary(
          reportTarget,
          common,
          'blocked',
          coachPreview.rows.length,
          resolution.staff,
          resolution.reasons
        )
      );
      continue;
    }

    const assistantCoachNames = resolution.assistantCoaches.map((c) => c.name);

    // --- Update an existing team -----------------------------------------------------
    if (existingTeam) {
      if (claimedExistingTeamIds.has(existingTeam.teamId)) {
        targets.push(
          blockedCoachSummary(reportTarget, common, 'duplicate-target', coachPreview.rows.length, resolution.staff, [
            `Another target already updates team ${existingTeam.teamId}; blocked to avoid conflicting coach updates.`,
          ])
        );
        continue;
      }
      claimedExistingTeamIds.add(existingTeam.teamId);
      // Replace ONLY the coaching fields; preserve players, ids, draft-order, and everything else.
      teamsToUpdate.push({
        ...existingTeam,
        headCoach: resolution.headCoach,
        assistantCoaches: resolution.assistantCoaches,
      });
      targets.push({
        ...baseCoachFields(reportTarget, common),
        teamId: existingTeam.teamId,
        action: 'update',
        status: 'update',
        committable: true,
        coachCount: coachPreview.rows.length,
        headCoachName: resolution.headCoach?.name ?? null,
        assistantCoachNames,
        staff: resolution.staff,
        reasons: routingNote ? [routingNote] : [],
      });
      continue;
    }

    // --- Create a brand-new coach-only team -----------------------------------------
    const teamId = `${ctx.seasonId}-${ctx.districtId}-${ctx.ageDivisionId}-${ctx.teamClassification}`;
    if (claimedNewTeamIds.has(teamId)) {
      targets.push(
        blockedCoachSummary(reportTarget, common, 'duplicate-target', coachPreview.rows.length, resolution.staff, [
          `Another target already creates team ${teamId}; blocked to avoid duplicate teams.`,
        ])
      );
      continue;
    }
    claimedNewTeamIds.add(teamId);
    teamsToCreate.push({
      teamId,
      seasonId: ctx.seasonId,
      districtId: ctx.districtId,
      ageDivisionId: ctx.ageDivisionId,
      teamCode: ctx.teamClassification,
      // draftOrder / divisionTeamCount are finalized below once all creates are known.
      draftOrder: 0,
      divisionTeamCount: 0,
      headCoach: resolution.headCoach,
      assistantCoaches: resolution.assistantCoaches,
      players: [],
    });
    targets.push({
      ...baseCoachFields(reportTarget, common),
      teamId,
      action: 'create',
      status: 'create',
      committable: true,
      coachCount: coachPreview.rows.length,
      headCoachName: resolution.headCoach?.name ?? null,
      assistantCoachNames,
      staff: resolution.staff,
      reasons: routingNote ? [routingNote] : [],
    });
  }

  finalizeCreatedTeamDraftOrders(teamsToCreate, input.existingTeams);

  const createCount = teamsToCreate.length;
  const updateCount = teamsToUpdate.length;
  const emptyCount = targets.filter((t) => t.status === 'empty').length;
  const blockedCount = targets.filter((t) => t.action === 'blocked' && t.status !== 'empty').length;
  const totalCoachingStaff = [...teamsToCreate, ...teamsToUpdate].reduce(
    (sum, t) => sum + countStaff(t.headCoach, t.assistantCoaches),
    0
  );
  const canCommit = blockedCount === 0 && createCount + updateCount > 0;

  return {
    recordType,
    isCoachFile,
    totalTargets: targets.length,
    coachTargetCount: targets.length,
    createCount,
    updateCount,
    blockedCount,
    emptyCount,
    totalCoachingStaff,
    districtsResolvedCount: targets.filter((t) => t.districtResolved).length,
    districtsProvisionalCount: targets.filter((t) => !t.districtResolved).length,
    canCommit,
    targets,
    teamsToCreate,
    teamsToUpdate,
  };
}

// ---------------------------------------------------------------------------
// Summary builders
// ---------------------------------------------------------------------------

type CommonCoachFields = {
  districtResolved: boolean;
  districtId: string | null;
  ageDivisionId: string | null;
  teamClassification: string | null;
  existingTeamId: string | null;
  routedFromParenthetical: boolean;
  sourceDistrictName: string | null;
  representedDistrictName: string | null;
};

function baseCoachFields(
  reportTarget: {
    sourceTargetId: string;
    teamName: string | null;
    districtName: string | null;
    ageDivisionLabel: string | null;
  },
  common: CommonCoachFields
): Omit<
  WholeFileCoachTargetSummary,
  | 'teamId'
  | 'action'
  | 'status'
  | 'committable'
  | 'coachCount'
  | 'headCoachName'
  | 'assistantCoachNames'
  | 'staff'
  | 'reasons'
> {
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

function blockedCoachSummary(
  reportTarget: {
    sourceTargetId: string;
    teamName: string | null;
    districtName: string | null;
    ageDivisionLabel: string | null;
  },
  common: CommonCoachFields,
  status: WholeFileCoachTargetStatus,
  coachCount: number,
  staff: WholeFileCoachStaffMember[],
  reasons: string[]
): WholeFileCoachTargetSummary {
  return {
    ...baseCoachFields(reportTarget, common),
    teamId: null,
    action: 'blocked',
    status,
    committable: false,
    coachCount,
    headCoachName: null,
    assistantCoachNames: [],
    staff,
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
// Commit transaction (all-or-nothing) + undo
// ---------------------------------------------------------------------------

export type WholeFileCoachImportCommitSummary = {
  teamsCreated: number;
  teamsUpdated: number;
  coachingStaffImported: number;
  blockedTargets: number;
  committed: boolean;
  undoAvailable: boolean;
};

export type WholeFileCoachImportCommitResult =
  | {
      committed: true;
      workspace: WorkspaceData;
      /** Pre-commit values of updated teams (for undo). */
      previousTeams: Team[];
      /** Ids of the brand-new coach-only teams (for undo). */
      createdTeamIds: string[];
      summary: WholeFileCoachImportCommitSummary;
    }
  | {
      committed: false;
      reason: 'not-a-coach-file' | 'blocked-targets' | 'nothing-to-commit' | 'commit-conflict';
      message: string;
      /** Offending team ids for a `commit-conflict`. */
      teamIds?: string[];
      workspace: WorkspaceData;
    };

/**
 * Commits a whole-file coach import plan into the workspace, ALL-OR-NOTHING. REFUSES when the
 * plan is not a coach file, when ANY target is blocked (coach-import rule), or when there is
 * nothing to create/update — no workspace change is made in those cases. Otherwise it creates the
 * coach-only teams, replaces the coaching fields of the updated teams, and preserves every other
 * team/player/game/district/coach record exactly (via the shared roster-import transform).
 * Returns undo info + a deterministic summary. Pure; never mutates inputs.
 */
export function commitWholeFileCoachImport(
  workspace: WorkspaceData,
  plan: WholeFileCoachImportPlan
): WholeFileCoachImportCommitResult {
  if (!plan.isCoachFile) {
    return {
      committed: false,
      reason: 'not-a-coach-file',
      message: 'This file is not a coach source, so there is nothing to commit here.',
      workspace,
    };
  }
  if (plan.blockedCount > 0) {
    return {
      committed: false,
      reason: 'blocked-targets',
      message: `${plan.blockedCount} coach target${
        plan.blockedCount === 1 ? ' is' : 's are'
      } blocked. Resolve every blocked target before committing (the whole-file coach commit is all-or-nothing).`,
      workspace,
    };
  }
  if (plan.createCount + plan.updateCount === 0) {
    return {
      committed: false,
      reason: 'nothing-to-commit',
      message: 'No coach teams to create or update.',
      workspace,
    };
  }

  const result = commitRosterImportToWorkspace(workspace, plan.teamsToUpdate, plan.teamsToCreate);
  if (!result.committed) {
    return {
      committed: false,
      reason: 'commit-conflict',
      message: `Coach import was not applied (${result.reason}: ${result.teamIds.join(', ')}). No teams were changed.`,
      teamIds: result.teamIds,
      workspace,
    };
  }

  return {
    committed: true,
    workspace: result.workspace,
    previousTeams: result.previousTeams,
    createdTeamIds: result.createdTeamIds,
    summary: {
      teamsCreated: plan.createCount,
      teamsUpdated: plan.updateCount,
      coachingStaffImported: plan.totalCoachingStaff,
      blockedTargets: plan.blockedCount,
      committed: true,
      undoAvailable: true,
    },
  };
}

/**
 * Reverts a committed whole-file coach import (removes created coach-only teams; restores the
 * prior coaching fields — and every other field — of updated teams) in the CURRENT workspace.
 * A thin, explicit wrapper over the shared roster-import undo so the session undo is symmetric
 * with the player flow. Pure; never mutates inputs.
 */
export function undoWholeFileCoachImport(
  workspace: WorkspaceData,
  previousTeams: Team[],
  createdTeamIds: string[]
): WorkspaceRosterImportUndoResult {
  return undoRosterImportInWorkspace(workspace, previousTeams, createdTeamIds);
}
