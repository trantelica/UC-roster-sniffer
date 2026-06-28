import type { WorkspaceData } from './workspaceSnapshot';

/**
 * Completion Milestone E1: PURE, deterministic assessment of how "empty" the workspace is,
 * plus the recommended first-run next actions — ENGINE ONLY.
 *
 * It exists so the first-run / empty-state UI can be driven by a tested helper instead of
 * scattered `length === 0` checks in React. It reads only what is passed in, never mutates it,
 * and makes no judgement about the bundled sample data (the caller decides what to render).
 */

export type WorkspaceEmptinessSignal = {
  hasTeams: boolean;
  hasSeasons: boolean;
  hasDistricts: boolean;
  hasGames: boolean;
  hasCoaches: boolean;
  /** No teams at all → nothing to view/filter for roster work; the first-run state applies. */
  isEmptyForRoster: boolean;
};

/** First-run next-action keys, in the order they should be offered. */
export type FirstRunAction =
  | 'import-dataset'
  | 'roster-import'
  | 'districts'
  | 'schedule-import';

function distinctSeasonCount(teams: { seasonId: string }[]): number {
  const seen = new Set<string>();
  for (const t of teams) seen.add(t.seasonId);
  return seen.size;
}

/**
 * Assesses workspace emptiness. `isEmptyForRoster` is true when there are no teams (so the
 * roster, My Team, standings, and analytics views have nothing to show). Pure.
 */
export function assessWorkspaceEmptiness(
  workspace: Pick<
    WorkspaceData,
    'districts' | 'teams' | 'games' | 'coaches'
  >
): WorkspaceEmptinessSignal {
  const hasTeams = workspace.teams.length > 0;
  return {
    hasTeams,
    hasSeasons: distinctSeasonCount(workspace.teams) > 0,
    hasDistricts: workspace.districts.length > 0,
    hasGames: workspace.games.length > 0,
    hasCoaches: workspace.coaches.length > 0,
    isEmptyForRoster: !hasTeams,
  };
}

/**
 * Returns the recommended first-run actions for an effectively-empty workspace. Importing a
 * dataset and scraped-roster import are always offered first; managing districts is offered
 * when no districts exist yet; schedule import is offered once teams exist but no games do.
 * Pure; deterministic order.
 */
export function recommendedFirstRunActions(
  signal: WorkspaceEmptinessSignal
): FirstRunAction[] {
  const actions: FirstRunAction[] = ['import-dataset', 'roster-import'];
  if (!signal.hasDistricts) actions.push('districts');
  if (signal.hasTeams && !signal.hasGames) actions.push('schedule-import');
  return actions;
}
