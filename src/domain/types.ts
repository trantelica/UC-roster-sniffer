/**
 * Completion Milestone C1: a district's registry lifecycle status. Districts are NEVER
 * destructively deleted — `inactive` is the only retirement path. A record with no
 * `status` field (e.g. an older snapshot or sample) is treated as `active` everywhere.
 */
export type DistrictStatus = 'active' | 'inactive';

export interface District {
  districtId: string;
  name: string;
  mascot: string;
  logoAssetPath: string;
  helmetAssetPath: string;
  primaryColor: string;
  secondaryColor: string;
  /**
   * Completion Milestone C1: registry lifecycle status. Optional for backward
   * compatibility — an absent value means `active` (see `isDistrictActive`). New seeded
   * and confirmed districts always set it explicitly.
   */
  status?: DistrictStatus;
  /**
   * Completion Milestone C1/C3: exact scraped source labels that should resolve to this
   * district during import mapping (in addition to `name`). Used ONLY for exact matching —
   * never fuzzy. Optional; absent means match on `name` alone.
   */
  sourceLabels?: string[];
  /**
   * Completion Milestone C1: true when this district's mascot/colors/logo/helmet are
   * placeholder values (e.g. a district confirmed during import, or a seed with no
   * authoritative branding yet). Real branding can be filled in later via District
   * Maintenance (C2). Absent means the branding is not flagged as placeholder.
   */
  brandingProvisional?: boolean;
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

/**
 * Phase 6 slice 26: derived game context. `championship` always counts as playoff context
 * for derived summaries; `regular` is the default when no playoff/championship flag is set.
 */
export type GameType = 'regular' | 'playoff' | 'championship';

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
  /**
   * Phase 6 slice 26 game context (all optional; absent defaults to non-neutral / regular).
   * `isChampionship` is also treated as playoff context for derived summaries.
   */
  isNeutralSite?: boolean;
  isPlayoff?: boolean;
  isChampionship?: boolean;
}

/**
 * Phase 7 slice 27: normalized coach/staff model, tracked separately from player rosters.
 * `Coach` (above) stays the roster-embedded shape ({ name }); these are the season-spanning
 * records. Coach identity is name-based and deterministic; ambiguity is surfaced, never
 * silently merged. Coach data never mutates rosters, games, or schedules.
 */
export type CoachRole = 'headCoach' | 'assistantCoach' | 'unknown';

export interface StaffCoach {
  coachId: string;
  displayName: string;
  /** Deterministic lowercase identity key for name-based matching. */
  identityKey: string;
  /** Raw source name, preserved exactly when available. */
  sourceName?: string;
  notes?: string;
}

export interface TeamCoachAssignment {
  assignmentId: string;
  seasonId: string;
  teamId: string;
  coachId: string;
  role: CoachRole;
  sourceLabel?: string;
  sourceRowId?: string;
  notes?: string;
}

export interface AppData {
  districts: District[];
  ageDivisions: AgeDivision[];
  teams: Team[];
  games: Game[];
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
}
