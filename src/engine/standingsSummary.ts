import type { AgeDivision, District, Game, Team } from '../domain/types';
import {
  summarizeTeamSchedule,
  formatTeamDisplayName,
  type ContextRecord,
} from './teamScheduleSummary';

/**
 * Phase 6 slice 26: PURE, deterministic STANDINGS — ENGINE ONLY.
 *
 * Produces standings for a selected season + age division from FINAL games only. Each row
 * reuses the per-team schedule summary (so context splits stay consistent), then ranks by
 * win percentage, wins, point differential, points for, display name, and finally teamId.
 *
 * Guardrails: never mutates inputs; opponents are resolved only through existing teams (a
 * game referencing an unknown team is counted for the participating selected team but flagged
 * via `unresolvedGameReferenceCount`, never invented). Only `final` games count toward the
 * record; scheduled/postponed/cancelled games do not.
 */

export const STANDINGS_SUMMARY_LOGIC_VERSION = 'phase6-slice26-standings-summary-v1';

export type StandingsRow = {
  rank: number;
  teamId: string;
  displayName: string;
  districtName: string;
  mascot: string | null;
  teamCode: string;
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  /** (wins + 0.5*ties) / gamesPlayed, or 0 when no games played. */
  winPercentage: number;
  regularSeasonRecord: ContextRecord;
  playoffRecord: ContextRecord;
  championshipRecord: ContextRecord;
  unresolvedGameReferenceCount: number;
};

export type StandingsResult = {
  seasonId: string;
  ageDivisionId: string;
  rows: StandingsRow[];
  totalFinalGames: number;
  unresolvedGameReferenceCount: number;
  hasFinalGames: boolean;
};

export type BuildStandingsInput = {
  teams: Team[];
  games: Game[];
  districts: District[];
  ageDivisions: AgeDivision[];
  seasonId: string;
  ageDivisionId: string;
};

function winPct(wins: number, ties: number, gamesPlayed: number): number {
  if (gamesPlayed === 0) return 0;
  return (wins + 0.5 * ties) / gamesPlayed;
}

function compareRows(a: StandingsRow, b: StandingsRow): number {
  if (b.winPercentage !== a.winPercentage) return b.winPercentage - a.winPercentage;
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (b.pointDifferential !== a.pointDifferential) return b.pointDifferential - a.pointDifferential;
  if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
  if (a.displayName !== b.displayName) return a.displayName < b.displayName ? -1 : 1;
  return a.teamId < b.teamId ? -1 : a.teamId > b.teamId ? 1 : 0;
}

/**
 * Builds standings for a season + age division. Pure; never mutates inputs. Counts only
 * `final` games and reuses the per-team schedule summary for record splits.
 */
export function buildStandings(input: BuildStandingsInput): StandingsResult {
  const { teams, games, districts, ageDivisions, seasonId, ageDivisionId } = input;
  const selectedTeams = teams.filter(
    (t) => t.seasonId === seasonId && t.ageDivisionId === ageDivisionId
  );

  const rows: StandingsRow[] = selectedTeams.map((team) => {
    const summary = summarizeTeamSchedule({
      teamId: team.teamId,
      games,
      teams,
      districts,
      ageDivisions,
    });
    const overall = summary.overallRecord;
    const district = districts.find((d) => d.districtId === team.districtId) ?? null;
    const unresolvedGameReferenceCount = summary.games.filter(
      (g) => g.status === 'final' && g.unresolvedReference
    ).length;
    return {
      rank: 0,
      teamId: team.teamId,
      displayName: formatTeamDisplayName(team, districts, ageDivisions),
      districtName: district?.name ?? team.districtId,
      mascot: district?.mascot ?? null,
      teamCode: team.teamCode,
      wins: overall.wins,
      losses: overall.losses,
      ties: overall.ties,
      gamesPlayed: overall.gamesPlayed,
      pointsFor: overall.pointsFor,
      pointsAgainst: overall.pointsAgainst,
      pointDifferential: overall.pointDifferential,
      winPercentage: winPct(overall.wins, overall.ties, overall.gamesPlayed),
      regularSeasonRecord: summary.regularSeasonRecord,
      playoffRecord: summary.playoffRecord,
      championshipRecord: summary.championshipRecord,
      unresolvedGameReferenceCount,
    };
  });

  rows.sort(compareRows);
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  const totalFinalGames = rows.reduce((sum, r) => sum + r.gamesPlayed, 0);
  const unresolvedGameReferenceCount = rows.reduce(
    (sum, r) => sum + r.unresolvedGameReferenceCount,
    0
  );

  return {
    seasonId,
    ageDivisionId,
    rows,
    totalFinalGames,
    unresolvedGameReferenceCount,
    hasFinalGames: rows.some((r) => r.gamesPlayed > 0),
  };
}
