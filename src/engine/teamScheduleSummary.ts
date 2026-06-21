import type { AgeDivision, District, Game, GameStatus, GameType, Team } from '../domain/types';

/**
 * Phase 6 slice 24: PURE, deterministic team SCHEDULE / RESULT summaries — ENGINE ONLY.
 *
 * Derives a selected team's schedule and win/loss/tie record from games between EXISTING
 * teams. Opponents are resolved through `Team.teamId` references — there is no opponent
 * object, and an unresolvable reference is reported (never invented). Only `final` games
 * with usable scores count toward the record; `scheduled` / `postponed` games are upcoming
 * and `cancelled` games are excluded from the record.
 *
 * Guardrails: never mutates inputs, never touches rosters (schedules/results do not change
 * roster records or infer player movement), preserves team names exactly, and returns a
 * deterministic ordering (scheduledDate, then weekLabel, then gameId).
 */

export const TEAM_SCHEDULE_SUMMARY_LOGIC_VERSION = 'phase6-slice26-team-schedule-summary-v2';

export type TeamGameResult = 'win' | 'loss' | 'tie';
export type GameHomeAway = 'home' | 'away';

/** A win/loss/tie record with point totals for a context (overall/regular/playoff/etc.). */
export type ContextRecord = {
  wins: number;
  losses: number;
  ties: number;
  gamesPlayed: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
};

function emptyContextRecord(): ContextRecord {
  return { wins: 0, losses: 0, ties: 0, gamesPlayed: 0, pointsFor: 0, pointsAgainst: 0, pointDifferential: 0 };
}

/** Derives a game's context type. `championship` always implies playoff context. */
export function deriveGameType(game: Game): GameType {
  if (game.isChampionship) return 'championship';
  if (game.isPlayoff) return 'playoff';
  return 'regular';
}

export type TeamScheduleGameView = {
  gameId: string;
  weekLabel: string;
  scheduledDate: string | null;
  homeAway: GameHomeAway;
  opponentTeamId: string;
  /** Resolved opponent display name, or the raw id when unresolved. */
  opponentDisplayName: string;
  status: GameStatus;
  /** Team-centered score, e.g. "21–14"; empty for non-final games. */
  scoreDisplay: string;
  /** "W" / "L" / "T" for final games; empty otherwise. */
  resultDisplay: string;
  result: TeamGameResult | null;
  location: string | null;
  /** Slice 26 context for display markers. */
  gameType: GameType;
  isNeutralSite: boolean;
  /** True when the opponent team reference could not be resolved. */
  unresolvedReference: boolean;
};

export type TeamScheduleSummary = {
  teamId: string;
  totalGames: number;
  completedGames: number;
  upcomingGames: number;
  cancelledGames: number;
  /** Overall (all final games) — kept flat for back-compatibility. */
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifferential: number;
  /** Slice 26 record splits. Playoff includes championship games; regular excludes both. */
  overallRecord: ContextRecord;
  regularSeasonRecord: ContextRecord;
  playoffRecord: ContextRecord;
  championshipRecord: ContextRecord;
  nextGame: TeamScheduleGameView | null;
  lastGame: TeamScheduleGameView | null;
  games: TeamScheduleGameView[];
};

/** Builds a team's display name from district/age-division context (names preserved). */
export function formatTeamDisplayName(
  team: Team,
  districts: District[],
  ageDivisions: AgeDivision[]
): string {
  const districtName =
    districts.find((d) => d.districtId === team.districtId)?.name ?? team.districtId;
  const ageDivisionName =
    ageDivisions.find((a) => a.ageDivisionId === team.ageDivisionId)?.name ??
    team.ageDivisionId;
  return `${districtName} ${ageDivisionName} ${team.teamCode}`;
}

function hasUsableScores(game: Game): boolean {
  return (
    typeof game.homeScore === 'number' &&
    Number.isFinite(game.homeScore) &&
    typeof game.awayScore === 'number' &&
    Number.isFinite(game.awayScore)
  );
}

/**
 * Derives the selected team's result for one game. Returns null unless the game is `final`,
 * has usable scores, and the team is a participant. Pure; never mutates the game.
 */
export function deriveTeamGameResult(
  game: Game,
  teamId: string
): TeamGameResult | null {
  if (game.status !== 'final' || !hasUsableScores(game)) return null;
  const isHome = game.homeTeamId === teamId;
  const isAway = game.awayTeamId === teamId;
  if (!isHome && !isAway) return null;
  const teamScore = (isHome ? game.homeScore : game.awayScore) as number;
  const opponentScore = (isHome ? game.awayScore : game.homeScore) as number;
  if (teamScore > opponentScore) return 'win';
  if (teamScore < opponentScore) return 'loss';
  return 'tie';
}

function compareGames(a: Game, b: Game): number {
  // scheduledDate ascending, nulls last; then weekLabel; then gameId.
  const da = a.scheduledDate ?? '';
  const db = b.scheduledDate ?? '';
  if (da !== db) {
    if (da === '') return 1;
    if (db === '') return -1;
    return da < db ? -1 : 1;
  }
  if (a.weekLabel !== b.weekLabel) return a.weekLabel < b.weekLabel ? -1 : 1;
  if (a.gameId !== b.gameId) return a.gameId < b.gameId ? -1 : 1;
  return 0;
}

/**
 * Returns the games involving a team (home or away), deterministically ordered. Pure; does
 * not mutate the input array (sorts a copy).
 */
export function getTeamSchedule(teamId: string, games: Game[]): Game[] {
  return games
    .filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId)
    .slice()
    .sort(compareGames);
}

export type UnresolvedScheduleReference = {
  gameId: string;
  missingTeamIds: string[];
};

/**
 * Reports games whose home/away team references are not present in `teams`. Pure; never
 * mutates inputs. Used by snapshot validation (opponents must be existing teams).
 */
export function validateScheduleReferences(
  games: Game[],
  teams: Team[]
): UnresolvedScheduleReference[] {
  const teamIds = new Set(teams.map((t) => t.teamId));
  const unresolved: UnresolvedScheduleReference[] = [];
  for (const game of games) {
    const missing: string[] = [];
    if (!teamIds.has(game.homeTeamId)) missing.push(game.homeTeamId);
    if (!teamIds.has(game.awayTeamId)) missing.push(game.awayTeamId);
    if (missing.length > 0) unresolved.push({ gameId: game.gameId, missingTeamIds: missing });
  }
  return unresolved;
}

function toGameView(
  game: Game,
  teamId: string,
  teamsById: Map<string, Team>,
  districts: District[],
  ageDivisions: AgeDivision[]
): TeamScheduleGameView {
  const isHome = game.homeTeamId === teamId;
  const opponentTeamId = isHome ? game.awayTeamId : game.homeTeamId;
  const opponentTeam = teamsById.get(opponentTeamId) ?? null;
  const result = deriveTeamGameResult(game, teamId);

  let scoreDisplay = '';
  let resultDisplay = '';
  if (game.status === 'final' && hasUsableScores(game)) {
    const teamScore = (isHome ? game.homeScore : game.awayScore) as number;
    const opponentScore = (isHome ? game.awayScore : game.homeScore) as number;
    scoreDisplay = `${teamScore}–${opponentScore}`;
    resultDisplay = result === 'win' ? 'W' : result === 'loss' ? 'L' : 'T';
  }

  return {
    gameId: game.gameId,
    weekLabel: game.weekLabel,
    scheduledDate: game.scheduledDate,
    homeAway: isHome ? 'home' : 'away',
    opponentTeamId,
    opponentDisplayName: opponentTeam
      ? formatTeamDisplayName(opponentTeam, districts, ageDivisions)
      : opponentTeamId,
    status: game.status,
    scoreDisplay,
    resultDisplay,
    result,
    location: game.location ?? null,
    gameType: deriveGameType(game),
    isNeutralSite: game.isNeutralSite === true,
    unresolvedReference: opponentTeam === null,
  };
}

/** Adds one final game's result into a context record. Mutates the accumulator only. */
function accumulate(
  record: ContextRecord,
  result: TeamGameResult,
  teamScore: number,
  opponentScore: number
): void {
  record.gamesPlayed += 1;
  record.pointsFor += teamScore;
  record.pointsAgainst += opponentScore;
  record.pointDifferential = record.pointsFor - record.pointsAgainst;
  if (result === 'win') record.wins += 1;
  else if (result === 'loss') record.losses += 1;
  else record.ties += 1;
}

export type SummarizeTeamScheduleInput = {
  teamId: string;
  games: Game[];
  teams: Team[];
  districts: District[];
  ageDivisions: AgeDivision[];
};

/**
 * Builds the read-only team schedule/result summary. Pure; never mutates inputs. Only
 * `final` games with usable scores count toward the record and points.
 */
export function summarizeTeamSchedule(
  input: SummarizeTeamScheduleInput
): TeamScheduleSummary {
  const { teamId, games, teams, districts, ageDivisions } = input;
  const teamsById = new Map(teams.map((t) => [t.teamId, t]));
  const scheduled = getTeamSchedule(teamId, games);
  const views = scheduled.map((g) =>
    toGameView(g, teamId, teamsById, districts, ageDivisions)
  );

  const overallRecord = emptyContextRecord();
  const regularSeasonRecord = emptyContextRecord();
  const playoffRecord = emptyContextRecord();
  const championshipRecord = emptyContextRecord();
  let upcomingGames = 0;
  let cancelledGames = 0;

  for (const game of scheduled) {
    const isHome = game.homeTeamId === teamId;
    if (game.status === 'final' && hasUsableScores(game)) {
      const teamScore = (isHome ? game.homeScore : game.awayScore) as number;
      const opponentScore = (isHome ? game.awayScore : game.homeScore) as number;
      const result = deriveTeamGameResult(game, teamId);
      if (!result) continue;
      accumulate(overallRecord, result, teamScore, opponentScore);
      const gameType = deriveGameType(game);
      if (gameType === 'championship') {
        accumulate(championshipRecord, result, teamScore, opponentScore);
        accumulate(playoffRecord, result, teamScore, opponentScore);
      } else if (gameType === 'playoff') {
        accumulate(playoffRecord, result, teamScore, opponentScore);
      } else {
        accumulate(regularSeasonRecord, result, teamScore, opponentScore);
      }
    } else if (game.status === 'scheduled' || game.status === 'postponed') {
      upcomingGames += 1;
    } else if (game.status === 'cancelled') {
      cancelledGames += 1;
    }
  }

  const nextGame =
    views.find((v) => v.status === 'scheduled' || v.status === 'postponed') ?? null;
  const completedViews = views.filter(
    (v) => v.status === 'final' && v.scoreDisplay !== ''
  );
  const lastGame =
    completedViews.length > 0 ? completedViews[completedViews.length - 1] : null;

  return {
    teamId,
    totalGames: scheduled.length,
    completedGames: overallRecord.gamesPlayed,
    upcomingGames,
    cancelledGames,
    wins: overallRecord.wins,
    losses: overallRecord.losses,
    ties: overallRecord.ties,
    pointsFor: overallRecord.pointsFor,
    pointsAgainst: overallRecord.pointsAgainst,
    pointDifferential: overallRecord.pointDifferential,
    overallRecord,
    regularSeasonRecord,
    playoffRecord,
    championshipRecord,
    nextGame,
    lastGame,
    games: views,
  };
}
