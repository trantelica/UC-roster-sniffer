import type { Team } from '../domain/types';

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
