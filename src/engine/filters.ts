import type { Team } from '../domain/types';

/**
 * A team is "materialized" when loaded data actually populated it — i.e. it has at least one
 * rostered player (or an assigned coach). Empty team shells (e.g. provisional seed shells with
 * no roster) are NOT materialized. The Team selector lists only materialized teams so a user
 * sees the teams real data produced, not every theoretical/seeded team label. Pure.
 */
export function isMaterializedTeam(team: Team): boolean {
  return (
    team.players.length > 0 ||
    team.headCoach !== null ||
    team.assistantCoaches.length > 0
  );
}

/** Returns only the materialized teams (see {@link isMaterializedTeam}). Pure; preserves order. */
export function getMaterializedTeams(teams: Team[]): Team[] {
  return teams.filter(isMaterializedTeam);
}

export function getDistinctSeasons(teams: Team[]): string[] {
  const seen = new Set<string>();
  for (const t of teams) seen.add(t.seasonId);
  return Array.from(seen).sort();
}

export function getDistinctDistricts(teams: Team[], seasonId: string): string[] {
  const seen = new Set<string>();
  for (const t of teams) {
    if (t.seasonId === seasonId) seen.add(t.districtId);
  }
  return Array.from(seen).sort();
}

export function getDistinctAgeDivisions(
  teams: Team[],
  seasonId: string,
  districtId: string
): string[] {
  const seen = new Set<string>();
  for (const t of teams) {
    if (t.seasonId === seasonId && t.districtId === districtId) {
      seen.add(t.ageDivisionId);
    }
  }
  return Array.from(seen);
}

export function filterTeams(
  teams: Team[],
  seasonId: string,
  districtId: string | null,
  ageDivisionId: string | null
): Team[] {
  return teams.filter((t) => {
    if (t.seasonId !== seasonId) return false;
    if (districtId !== null && t.districtId !== districtId) return false;
    if (ageDivisionId !== null && t.ageDivisionId !== ageDivisionId) return false;
    return true;
  });
}
