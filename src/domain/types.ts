export interface District {
  districtId: string;
  name: string;
  mascot: string;
  logoAssetPath: string;
  helmetAssetPath: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface AgeDivision {
  ageDivisionId: string;
  name: string;
  leagueLabel: string;
  ordinal: number;
  typicalAges: number[];
}

export interface Player {
  name: string;
  notes?: string;
}

export interface Coach {
  name: string;
}

export interface Team {
  teamId: string;
  seasonId: string;
  districtId: string;
  ageDivisionId: string;
  teamCode: string;
  draftOrder: number;
  divisionTeamCount: number;
  headCoach: Coach | null;
  assistantCoaches: Coach[];
  players: Player[];
}

/**
 * Phase 6 slice 24: a scheduled or completed game between two EXISTING teams. Opponents
 * are never separate objects — `homeTeamId` / `awayTeamId` reference `Team.teamId` values.
 * Schedules/results are maintained separately from roster imports and never mutate rosters.
 */
export type GameStatus = 'scheduled' | 'final' | 'cancelled' | 'postponed';

export interface Game {
  gameId: string;
  seasonId: string;
  /** Optional; useful for filtering/display. */
  ageDivisionId?: string;
  weekLabel: string;
  /** ISO date string (e.g. "2026-08-22"), or null when not yet scheduled. */
  scheduledDate: string | null;
  homeTeamId: string;
  awayTeamId: string;
  location?: string;
  status: GameStatus;
  /** Required in practice only for `final` games. */
  homeScore?: number;
  awayScore?: number;
  notes?: string;
}

export interface AppData {
  districts: District[];
  ageDivisions: AgeDivision[];
  teams: Team[];
  games: Game[];
}
