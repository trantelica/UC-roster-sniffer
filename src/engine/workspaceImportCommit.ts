import type { Team } from '../domain/types';
import type { WorkspaceData } from './workspaceSnapshot';

/**
 * Completion Milestone B1: PURE, deterministic workspace transformation for committing one
 * previewed/executed scraped-JSON team into the COMMITTED workspace, plus a session undo.
 *
 * This helper does the workspace-level write only. The roster transformation itself (which
 * records to add / link / defer, in which order) is owned and tested by the existing
 * `executeUteConferenceScrapedJsonImportTransaction` helper, which produces the
 * `committedTeam` value passed in here. This module never re-implements those import
 * semantics; it only swaps the affected team into the workspace.
 *
 * Guardrails: never mutates the input workspace, its teams array, or any team/player. Updates
 * ONLY the team whose `teamId` matches; every other team, game, coach, coach assignment,
 * district, and age division is preserved exactly. It updates an EXISTING team only and never
 * silently creates a new team (refused with `committed: false`). Durability is not this
 * module's concern — the caller's workspace state change triggers the A1 auto-save naturally.
 */

export type WorkspaceImportCommitResult =
  | {
      committed: true;
      workspace: WorkspaceData;
      /** The pre-commit value of the affected team, for a current-session undo. */
      previousTeam: Team;
    }
  | {
      committed: false;
      reason: 'target-team-not-found';
      /** The unchanged workspace (no team with the committed team's id exists). */
      workspace: WorkspaceData;
    };

/**
 * Commits a previewed/executed team into the committed workspace, replacing ONLY the team
 * that shares its `teamId`. Returns the new workspace plus the previous team value for undo.
 * Refuses when no existing team with that id is present (B1 updates an existing team only).
 */
export function commitImportedTeamToWorkspace(
  workspace: WorkspaceData,
  committedTeam: Team
): WorkspaceImportCommitResult {
  const existing = workspace.teams.find((t) => t.teamId === committedTeam.teamId);
  if (!existing) {
    return { committed: false, reason: 'target-team-not-found', workspace };
  }
  const teams = workspace.teams.map((t) =>
    t.teamId === committedTeam.teamId ? committedTeam : t
  );
  return {
    committed: true,
    workspace: { ...workspace, teams },
    previousTeam: existing,
  };
}

// ---------------------------------------------------------------------------
// Completion Milestone B2: all-or-nothing BATCH commit/undo (whole-file import)
// ---------------------------------------------------------------------------

export type WorkspaceBatchCommitResult =
  | {
      committed: true;
      workspace: WorkspaceData;
      /** Pre-commit values of every affected team, in input order, for a batch undo. */
      previousTeams: Team[];
    }
  | {
      committed: false;
      reason: 'target-team-not-found';
      /** Team ids in the batch that have no matching existing team (nothing was changed). */
      missingTeamIds: string[];
      /** The unchanged workspace. */
      workspace: WorkspaceData;
    };

/**
 * Commits a batch of previewed/executed teams into the committed workspace, ALL-OR-NOTHING:
 * if ANY team in the batch has no matching existing team, nothing is changed and the missing
 * ids are returned. Otherwise every matching team is replaced by its `teamId` and the
 * pre-commit team values are returned (in input order) for a batch undo. Every other team,
 * game, coach, assignment, district, and age division is preserved exactly. Updates EXISTING
 * teams only (never creates a team). Pure; never mutates inputs.
 */
export function commitImportedTeamsToWorkspace(
  workspace: WorkspaceData,
  committedTeams: Team[]
): WorkspaceBatchCommitResult {
  const byId = new Map(workspace.teams.map((t) => [t.teamId, t] as const));
  const missingTeamIds = committedTeams
    .map((t) => t.teamId)
    .filter((id) => !byId.has(id));
  if (missingTeamIds.length > 0) {
    return { committed: false, reason: 'target-team-not-found', missingTeamIds, workspace };
  }
  const replacements = new Map(committedTeams.map((t) => [t.teamId, t] as const));
  const previousTeams = committedTeams.map((t) => byId.get(t.teamId) as Team);
  const teams = workspace.teams.map((t) => replacements.get(t.teamId) ?? t);
  return { committed: true, workspace: { ...workspace, teams }, previousTeams };
}

export type WorkspaceBatchUndoResult =
  | { restored: true; workspace: WorkspaceData }
  | {
      restored: false;
      reason: 'target-team-not-found';
      missingTeamIds: string[];
      workspace: WorkspaceData;
    };

/**
 * Reverts a batch commit by restoring every previous team value into the CURRENT workspace,
 * ALL-OR-NOTHING: if any target team is no longer present, nothing is changed. Operates on
 * the current workspace (not a stale snapshot), so unrelated later changes to OTHER teams are
 * preserved. Pure; never mutates inputs.
 */
export function undoImportedTeamsCommitInWorkspace(
  workspace: WorkspaceData,
  previousTeams: Team[]
): WorkspaceBatchUndoResult {
  const presentIds = new Set(workspace.teams.map((t) => t.teamId));
  const missingTeamIds = previousTeams
    .map((t) => t.teamId)
    .filter((id) => !presentIds.has(id));
  if (missingTeamIds.length > 0) {
    return { restored: false, reason: 'target-team-not-found', missingTeamIds, workspace };
  }
  const restorations = new Map(previousTeams.map((t) => [t.teamId, t] as const));
  const teams = workspace.teams.map((t) => restorations.get(t.teamId) ?? t);
  return { restored: true, workspace: { ...workspace, teams } };
}

export type WorkspaceImportUndoResult =
  | { restored: true; workspace: WorkspaceData }
  | { restored: false; reason: 'target-team-not-found'; workspace: WorkspaceData };

/**
 * Reverts a committed import by restoring the previous team value into the CURRENT workspace,
 * replacing ONLY that team. Operates on the current workspace (not a stale snapshot), so any
 * unrelated changes made after the commit are preserved. Refuses when the team is no longer
 * present. Pure; never mutates inputs.
 */
export function undoImportedTeamCommitInWorkspace(
  workspace: WorkspaceData,
  previousTeam: Team
): WorkspaceImportUndoResult {
  const present = workspace.teams.some((t) => t.teamId === previousTeam.teamId);
  if (!present) {
    return { restored: false, reason: 'target-team-not-found', workspace };
  }
  const teams = workspace.teams.map((t) =>
    t.teamId === previousTeam.teamId ? previousTeam : t
  );
  return { restored: true, workspace: { ...workspace, teams } };
}
