import type {
  AgeDivision,
  Coach,
  CoachRole,
  District,
  Game,
  GameStatus,
  Player,
  StaffCoach,
  Team,
  TeamCoachAssignment,
} from '../domain/types';
import { validateScheduleReferences } from './teamScheduleSummary';
import { validateCoachAssignments } from './coachHistorySummary';

/**
 * Phase 5 slice 23: PURE, deterministic PORTABLE WORKSPACE SNAPSHOT — ENGINE ONLY.
 *
 * A workspace snapshot is a versioned, JSON-serializable capture of the current local
 * roster workspace (districts, age divisions, teams/rosters, plus the active selection)
 * that the user can explicitly download to a file and later upload to restore the app's
 * working state. It provides durability ONLY because the user moves a file by hand.
 *
 * This is distinct from the import PREVIEW ARTIFACT (slice 20/21/22), which documents an
 * import workflow. A workspace snapshot RESTORES the whole app workspace.
 *
 * Guardrails: this is NOT automatic persistence. These helpers never read or write
 * `localStorage` / `IndexedDB` / a backend / files / app state — the component performs
 * the explicit user-triggered download/upload. They never mutate inputs, preserve names
 * and identifiers exactly, and are deterministic given a caller-supplied `generatedAt`.
 * Restore REPLACES the workspace (it never merges) and validation rejects obvious junk so
 * it cannot silently replace good state with garbage.
 */

export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = 1;
export const WORKSPACE_SNAPSHOT_KIND = 'workspace';
export const WORKSPACE_SNAPSHOT_APP = 'uc-roster-sniffer';
export const WORKSPACE_SNAPSHOT_LOGIC_VERSION = 'phase5-slice23-workspace-snapshot-v1';

const SNAPSHOT_NOTE =
  'Portable workspace snapshot. Source is a user-exported JSON file — not a database, browser storage, or cloud sync. Importing it replaces the current in-memory workspace after validation.';

export type WorkspaceSnapshotSelection = {
  seasonId: string | null;
  districtId: string | null;
  ageDivisionId: string | null;
  teamId: string | null;
};

export type WorkspaceSnapshotSummary = {
  schemaVersion: number;
  generatedAt: string;
  seasonCount: number;
  districtCount: number;
  ageDivisionCount: number;
  teamCount: number;
  playerCount: number;
  gameCount: number;
  coachCount: number;
  coachAssignmentCount: number;
};

export type WorkspaceData = {
  districts: District[];
  ageDivisions: AgeDivision[];
  teams: Team[];
  /**
   * Phase 6 slice 24: schedules/results. Optional on input for backward compatibility
   * with slice-23 snapshots that predate games; treated as an empty list when absent.
   */
  games: Game[];
  /**
   * Phase 7 slice 27: coach/staff model. Optional on input for backward compatibility with
   * snapshots that predate coaches; treated as empty lists when absent.
   */
  coaches: StaffCoach[];
  coachAssignments: TeamCoachAssignment[];
};

export type WorkspaceState = WorkspaceData & {
  selection: WorkspaceSnapshotSelection;
};

export type WorkspaceSnapshot = {
  appName: string;
  snapshotKind: string;
  schemaVersion: number;
  generatedAt: string;
  source: 'user-exported-json';
  note: string;
  selection: WorkspaceSnapshotSelection;
  workspace: WorkspaceData;
  summary: WorkspaceSnapshotSummary;
};

// ---------------------------------------------------------------------------
// Deep-copy helpers (preserve names/identifiers exactly; never share references)
// ---------------------------------------------------------------------------

function copyCoach(coach: Coach): Coach {
  return { name: coach.name };
}

function copyPlayer(player: Player): Player {
  return player.notes === undefined
    ? { name: player.name }
    : { name: player.name, notes: player.notes };
}

function copyTeam(team: Team): Team {
  return {
    teamId: team.teamId,
    seasonId: team.seasonId,
    districtId: team.districtId,
    ageDivisionId: team.ageDivisionId,
    teamCode: team.teamCode,
    draftOrder: team.draftOrder,
    divisionTeamCount: team.divisionTeamCount,
    headCoach: team.headCoach ? copyCoach(team.headCoach) : null,
    assistantCoaches: team.assistantCoaches.map(copyCoach),
    players: team.players.map(copyPlayer),
  };
}

function copyDistrict(district: District): District {
  return {
    districtId: district.districtId,
    name: district.name,
    mascot: district.mascot,
    logoAssetPath: district.logoAssetPath,
    helmetAssetPath: district.helmetAssetPath,
    primaryColor: district.primaryColor,
    secondaryColor: district.secondaryColor,
  };
}

function copyAgeDivision(ageDivision: AgeDivision): AgeDivision {
  return {
    ageDivisionId: ageDivision.ageDivisionId,
    name: ageDivision.name,
    leagueLabel: ageDivision.leagueLabel,
    ordinal: ageDivision.ordinal,
    typicalAges: [...ageDivision.typicalAges],
  };
}

function copyGame(game: Game): Game {
  const copy: Game = {
    gameId: game.gameId,
    seasonId: game.seasonId,
    weekLabel: game.weekLabel,
    scheduledDate: game.scheduledDate,
    homeTeamId: game.homeTeamId,
    awayTeamId: game.awayTeamId,
    status: game.status,
  };
  if (game.ageDivisionId !== undefined) copy.ageDivisionId = game.ageDivisionId;
  if (game.location !== undefined) copy.location = game.location;
  if (game.homeScore !== undefined) copy.homeScore = game.homeScore;
  if (game.awayScore !== undefined) copy.awayScore = game.awayScore;
  if (game.notes !== undefined) copy.notes = game.notes;
  if (game.isNeutralSite !== undefined) copy.isNeutralSite = game.isNeutralSite;
  if (game.isPlayoff !== undefined) copy.isPlayoff = game.isPlayoff;
  if (game.isChampionship !== undefined) copy.isChampionship = game.isChampionship;
  return copy;
}

function copyStaffCoach(coach: StaffCoach): StaffCoach {
  const copy: StaffCoach = {
    coachId: coach.coachId,
    displayName: coach.displayName,
    identityKey: coach.identityKey,
  };
  if (coach.sourceName !== undefined) copy.sourceName = coach.sourceName;
  if (coach.notes !== undefined) copy.notes = coach.notes;
  return copy;
}

function copyCoachAssignment(a: TeamCoachAssignment): TeamCoachAssignment {
  const copy: TeamCoachAssignment = {
    assignmentId: a.assignmentId,
    seasonId: a.seasonId,
    teamId: a.teamId,
    coachId: a.coachId,
    role: a.role,
  };
  if (a.sourceLabel !== undefined) copy.sourceLabel = a.sourceLabel;
  if (a.sourceRowId !== undefined) copy.sourceRowId = a.sourceRowId;
  if (a.notes !== undefined) copy.notes = a.notes;
  return copy;
}

function distinctSeasonIds(teams: Team[]): string[] {
  const seen = new Set<string>();
  for (const team of teams) seen.add(team.seasonId);
  return [...seen].sort();
}

function countPlayers(teams: Team[]): number {
  return teams.reduce((total, team) => total + team.players.length, 0);
}

function summarize(
  workspace: WorkspaceData,
  generatedAt: string
): WorkspaceSnapshotSummary {
  return {
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    seasonCount: distinctSeasonIds(workspace.teams).length,
    districtCount: workspace.districts.length,
    ageDivisionCount: workspace.ageDivisions.length,
    teamCount: workspace.teams.length,
    playerCount: countPlayers(workspace.teams),
    gameCount: workspace.games.length,
    coachCount: workspace.coaches.length,
    coachAssignmentCount: workspace.coachAssignments.length,
  };
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export type BuildWorkspaceSnapshotInput = {
  workspace: WorkspaceState;
  /** Caller-supplied stable timestamp (keeps output deterministic). */
  generatedAt: string;
};

/**
 * Builds a portable workspace snapshot from the current workspace state. Pure; never
 * mutates the input. Deep-copies all records so names/identifiers are preserved exactly
 * and the result shares no references with the input.
 */
export function buildWorkspaceSnapshot(
  input: BuildWorkspaceSnapshotInput
): WorkspaceSnapshot {
  const { workspace, generatedAt } = input;
  const copied: WorkspaceData = {
    districts: workspace.districts.map(copyDistrict),
    ageDivisions: workspace.ageDivisions.map(copyAgeDivision),
    teams: workspace.teams.map(copyTeam),
    games: (workspace.games ?? []).map(copyGame),
    coaches: (workspace.coaches ?? []).map(copyStaffCoach),
    coachAssignments: (workspace.coachAssignments ?? []).map(copyCoachAssignment),
  };
  return {
    appName: WORKSPACE_SNAPSHOT_APP,
    snapshotKind: WORKSPACE_SNAPSHOT_KIND,
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    source: 'user-exported-json',
    note: SNAPSHOT_NOTE,
    selection: { ...workspace.selection },
    workspace: copied,
    summary: summarize(copied, generatedAt),
  };
}

// ---------------------------------------------------------------------------
// Validation / parsing
// ---------------------------------------------------------------------------

export type WorkspaceSnapshotValidationErrorCode =
  | 'invalid-json'
  | 'not-an-object'
  | 'missing-schema-version'
  | 'unsupported-schema-version'
  | 'wrong-snapshot-kind'
  | 'invalid-workspace'
  | 'invalid-districts'
  | 'invalid-age-divisions'
  | 'invalid-teams'
  | 'invalid-games'
  | 'unresolved-game-reference'
  | 'invalid-coaches'
  | 'invalid-coach-assignments'
  | 'unresolved-coach-reference'
  | 'empty-workspace';

export type WorkspaceSnapshotValidationError = {
  code: WorkspaceSnapshotValidationErrorCode;
  message: string;
};

export type WorkspaceSnapshotParseResult =
  | { ok: true; snapshot: WorkspaceSnapshot }
  | { ok: false; errors: WorkspaceSnapshotValidationError[] };

function err(
  code: WorkspaceSnapshotValidationErrorCode,
  message: string
): WorkspaceSnapshotValidationError {
  return { code, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validDistrict(value: unknown): District | null {
  if (!isObject(value)) return null;
  if (!isNonEmptyString(value.districtId) || typeof value.name !== 'string') return null;
  return {
    districtId: value.districtId,
    name: value.name,
    mascot: typeof value.mascot === 'string' ? value.mascot : '',
    logoAssetPath: typeof value.logoAssetPath === 'string' ? value.logoAssetPath : '',
    helmetAssetPath:
      typeof value.helmetAssetPath === 'string' ? value.helmetAssetPath : '',
    primaryColor: typeof value.primaryColor === 'string' ? value.primaryColor : '',
    secondaryColor: typeof value.secondaryColor === 'string' ? value.secondaryColor : '',
  };
}

function validAgeDivision(value: unknown): AgeDivision | null {
  if (!isObject(value)) return null;
  if (!isNonEmptyString(value.ageDivisionId) || typeof value.name !== 'string') {
    return null;
  }
  return {
    ageDivisionId: value.ageDivisionId,
    name: value.name,
    leagueLabel: typeof value.leagueLabel === 'string' ? value.leagueLabel : '',
    ordinal: isFiniteNumber(value.ordinal) ? value.ordinal : 0,
    typicalAges: Array.isArray(value.typicalAges)
      ? value.typicalAges.filter(isFiniteNumber)
      : [],
  };
}

function validCoach(value: unknown): Coach | null {
  if (!isObject(value) || typeof value.name !== 'string') return null;
  return { name: value.name };
}

function validPlayer(value: unknown): Player | null {
  if (!isObject(value) || typeof value.name !== 'string') return null;
  return typeof value.notes === 'string'
    ? { name: value.name, notes: value.notes }
    : { name: value.name };
}

function validTeam(value: unknown): Team | null {
  if (!isObject(value)) return null;
  if (
    !isNonEmptyString(value.teamId) ||
    !isNonEmptyString(value.seasonId) ||
    !isNonEmptyString(value.districtId) ||
    !isNonEmptyString(value.ageDivisionId) ||
    typeof value.teamCode !== 'string'
  ) {
    return null;
  }
  if (!Array.isArray(value.players) || !Array.isArray(value.assistantCoaches)) {
    return null;
  }
  const players: Player[] = [];
  for (const raw of value.players) {
    const player = validPlayer(raw);
    if (!player) return null;
    players.push(player);
  }
  const assistantCoaches: Coach[] = [];
  for (const raw of value.assistantCoaches) {
    const coach = validCoach(raw);
    if (!coach) return null;
    assistantCoaches.push(coach);
  }
  let headCoach: Coach | null = null;
  if (value.headCoach !== null && value.headCoach !== undefined) {
    headCoach = validCoach(value.headCoach);
    if (!headCoach) return null;
  }
  return {
    teamId: value.teamId,
    seasonId: value.seasonId,
    districtId: value.districtId,
    ageDivisionId: value.ageDivisionId,
    teamCode: value.teamCode,
    draftOrder: isFiniteNumber(value.draftOrder) ? value.draftOrder : 0,
    divisionTeamCount: isFiniteNumber(value.divisionTeamCount)
      ? value.divisionTeamCount
      : 0,
    headCoach,
    assistantCoaches,
    players,
  };
}

const GAME_STATUSES: GameStatus[] = ['scheduled', 'final', 'cancelled', 'postponed'];

function validGame(value: unknown): Game | null {
  if (!isObject(value)) return null;
  if (
    !isNonEmptyString(value.gameId) ||
    !isNonEmptyString(value.seasonId) ||
    typeof value.weekLabel !== 'string' ||
    !isNonEmptyString(value.homeTeamId) ||
    !isNonEmptyString(value.awayTeamId)
  ) {
    return null;
  }
  if (!GAME_STATUSES.includes(value.status as GameStatus)) return null;
  if (
    value.scheduledDate !== null &&
    value.scheduledDate !== undefined &&
    typeof value.scheduledDate !== 'string'
  ) {
    return null;
  }
  // A final game must carry usable scores.
  if (value.status === 'final') {
    if (!isFiniteNumber(value.homeScore) || !isFiniteNumber(value.awayScore)) {
      return null;
    }
  }
  const game: Game = {
    gameId: value.gameId,
    seasonId: value.seasonId,
    weekLabel: value.weekLabel,
    scheduledDate: typeof value.scheduledDate === 'string' ? value.scheduledDate : null,
    homeTeamId: value.homeTeamId,
    awayTeamId: value.awayTeamId,
    status: value.status as GameStatus,
  };
  if (typeof value.ageDivisionId === 'string') game.ageDivisionId = value.ageDivisionId;
  if (typeof value.location === 'string') game.location = value.location;
  if (isFiniteNumber(value.homeScore)) game.homeScore = value.homeScore;
  if (isFiniteNumber(value.awayScore)) game.awayScore = value.awayScore;
  if (typeof value.notes === 'string') game.notes = value.notes;
  // Slice 26 context fields must be booleans when present (invalid types reject the game).
  for (const flag of ['isNeutralSite', 'isPlayoff', 'isChampionship'] as const) {
    if (value[flag] !== undefined) {
      if (typeof value[flag] !== 'boolean') return null;
      game[flag] = value[flag] as boolean;
    }
  }
  return game;
}

const COACH_ROLES: CoachRole[] = ['headCoach', 'assistantCoach', 'unknown'];

function validStaffCoach(value: unknown): StaffCoach | null {
  if (!isObject(value)) return null;
  if (
    !isNonEmptyString(value.coachId) ||
    typeof value.displayName !== 'string' ||
    !isNonEmptyString(value.identityKey)
  ) {
    return null;
  }
  const coach: StaffCoach = {
    coachId: value.coachId,
    displayName: value.displayName,
    identityKey: value.identityKey,
  };
  if (value.sourceName !== undefined) {
    if (typeof value.sourceName !== 'string') return null;
    coach.sourceName = value.sourceName;
  }
  if (value.notes !== undefined) {
    if (typeof value.notes !== 'string') return null;
    coach.notes = value.notes;
  }
  return coach;
}

function validCoachAssignment(value: unknown): TeamCoachAssignment | null {
  if (!isObject(value)) return null;
  if (
    !isNonEmptyString(value.assignmentId) ||
    !isNonEmptyString(value.seasonId) ||
    !isNonEmptyString(value.teamId) ||
    !isNonEmptyString(value.coachId)
  ) {
    return null;
  }
  if (!COACH_ROLES.includes(value.role as CoachRole)) return null;
  const assignment: TeamCoachAssignment = {
    assignmentId: value.assignmentId,
    seasonId: value.seasonId,
    teamId: value.teamId,
    coachId: value.coachId,
    role: value.role as CoachRole,
  };
  for (const field of ['sourceLabel', 'sourceRowId', 'notes'] as const) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== 'string') return null;
      assignment[field] = value[field] as string;
    }
  }
  return assignment;
}

function validSelection(value: unknown): WorkspaceSnapshotSelection {
  const s = isObject(value) ? value : {};
  const pick = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    seasonId: pick(s.seasonId),
    districtId: pick(s.districtId),
    ageDivisionId: pick(s.ageDivisionId),
    teamId: pick(s.teamId),
  };
}

/**
 * Validates an already-parsed value as a workspace snapshot. Pure; never mutates input.
 * Returns a rejected result (never throws) for expected validation failures, with stable
 * reason codes. On success, returns a snapshot rebuilt from validated, deep-copied data.
 */
export function validateWorkspaceSnapshot(
  value: unknown
): WorkspaceSnapshotParseResult {
  if (!isObject(value)) {
    return { ok: false, errors: [err('not-an-object', 'Snapshot is not a JSON object.')] };
  }
  if (value.schemaVersion === undefined || value.schemaVersion === null) {
    return {
      ok: false,
      errors: [err('missing-schema-version', 'Snapshot is missing a schemaVersion.')],
    };
  }
  if (value.schemaVersion !== WORKSPACE_SNAPSHOT_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        err(
          'unsupported-schema-version',
          `Unsupported schemaVersion ${String(value.schemaVersion)}; expected ${WORKSPACE_SNAPSHOT_SCHEMA_VERSION}.`
        ),
      ],
    };
  }
  if (value.snapshotKind !== WORKSPACE_SNAPSHOT_KIND) {
    return {
      ok: false,
      errors: [
        err(
          'wrong-snapshot-kind',
          `Expected snapshotKind "${WORKSPACE_SNAPSHOT_KIND}" but found "${String(value.snapshotKind)}". (A preview artifact is not a workspace snapshot.)`
        ),
      ],
    };
  }
  if (!isObject(value.workspace)) {
    return {
      ok: false,
      errors: [err('invalid-workspace', 'Snapshot is missing a valid workspace object.')],
    };
  }

  const ws = value.workspace;
  const errors: WorkspaceSnapshotValidationError[] = [];

  if (!Array.isArray(ws.districts)) {
    errors.push(err('invalid-districts', 'workspace.districts must be an array.'));
  }
  if (!Array.isArray(ws.ageDivisions)) {
    errors.push(err('invalid-age-divisions', 'workspace.ageDivisions must be an array.'));
  }
  if (!Array.isArray(ws.teams)) {
    errors.push(err('invalid-teams', 'workspace.teams must be an array.'));
  }
  if (errors.length > 0) return { ok: false, errors };

  const districts: District[] = [];
  for (const raw of ws.districts as unknown[]) {
    const district = validDistrict(raw);
    if (!district) {
      errors.push(err('invalid-districts', 'A district entry is structurally invalid.'));
      break;
    }
    districts.push(district);
  }
  const ageDivisions: AgeDivision[] = [];
  for (const raw of ws.ageDivisions as unknown[]) {
    const ageDivision = validAgeDivision(raw);
    if (!ageDivision) {
      errors.push(
        err('invalid-age-divisions', 'An age-division entry is structurally invalid.')
      );
      break;
    }
    ageDivisions.push(ageDivision);
  }
  const teams: Team[] = [];
  for (const raw of ws.teams as unknown[]) {
    const team = validTeam(raw);
    if (!team) {
      errors.push(err('invalid-teams', 'A team entry is structurally invalid.'));
      break;
    }
    teams.push(team);
  }
  if (errors.length > 0) return { ok: false, errors };

  if (teams.length === 0) {
    return {
      ok: false,
      errors: [
        err('empty-workspace', 'Snapshot contains no teams, so there is nothing to restore.'),
      ],
    };
  }

  // Games are optional (slice-23 snapshots predate them). When present they must be a
  // valid array, and every game must reference existing teams (opponents are not objects).
  const games: Game[] = [];
  if (ws.games !== undefined && ws.games !== null) {
    if (!Array.isArray(ws.games)) {
      return {
        ok: false,
        errors: [err('invalid-games', 'workspace.games must be an array when present.')],
      };
    }
    for (const raw of ws.games as unknown[]) {
      const game = validGame(raw);
      if (!game) {
        return {
          ok: false,
          errors: [err('invalid-games', 'A game entry is structurally invalid.')],
        };
      }
      games.push(game);
    }
    const unresolved = validateScheduleReferences(games, teams);
    if (unresolved.length > 0) {
      return {
        ok: false,
        errors: [
          err(
            'unresolved-game-reference',
            `Game ${unresolved[0].gameId} references team(s) not in the snapshot: ${unresolved[0].missingTeamIds.join(', ')}. Opponents must be existing teams.`
          ),
        ],
      };
    }
  }

  // Coaches/assignments are optional (older snapshots predate them). When present they must
  // be valid arrays, and every assignment must reference an existing coach + team.
  const coaches: StaffCoach[] = [];
  if (ws.coaches !== undefined && ws.coaches !== null) {
    if (!Array.isArray(ws.coaches)) {
      return {
        ok: false,
        errors: [err('invalid-coaches', 'workspace.coaches must be an array when present.')],
      };
    }
    for (const raw of ws.coaches as unknown[]) {
      const coach = validStaffCoach(raw);
      if (!coach) {
        return {
          ok: false,
          errors: [err('invalid-coaches', 'A coach entry is structurally invalid.')],
        };
      }
      coaches.push(coach);
    }
  }
  const coachAssignments: TeamCoachAssignment[] = [];
  if (ws.coachAssignments !== undefined && ws.coachAssignments !== null) {
    if (!Array.isArray(ws.coachAssignments)) {
      return {
        ok: false,
        errors: [
          err('invalid-coach-assignments', 'workspace.coachAssignments must be an array when present.'),
        ],
      };
    }
    for (const raw of ws.coachAssignments as unknown[]) {
      const assignment = validCoachAssignment(raw);
      if (!assignment) {
        return {
          ok: false,
          errors: [
            err('invalid-coach-assignments', 'A coach assignment entry is structurally invalid.'),
          ],
        };
      }
      coachAssignments.push(assignment);
    }
    const unresolved = validateCoachAssignments(coachAssignments, coaches, teams);
    if (unresolved.length > 0) {
      const first = unresolved[0];
      const missing = [
        first.missingCoachId ? 'coach' : null,
        first.missingTeamId ? 'team' : null,
      ]
        .filter(Boolean)
        .join(' and ');
      return {
        ok: false,
        errors: [
          err(
            'unresolved-coach-reference',
            `Assignment ${first.assignmentId} references a ${missing} not in the snapshot. Coaches and teams must exist.`
          ),
        ],
      };
    }
  }

  const generatedAt =
    typeof value.generatedAt === 'string' ? value.generatedAt : '';
  const workspace: WorkspaceData = { districts, ageDivisions, teams, games, coaches, coachAssignments };
  const snapshot: WorkspaceSnapshot = {
    appName: typeof value.appName === 'string' ? value.appName : WORKSPACE_SNAPSHOT_APP,
    snapshotKind: WORKSPACE_SNAPSHOT_KIND,
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    generatedAt,
    source: 'user-exported-json',
    note: SNAPSHOT_NOTE,
    selection: validSelection(value.selection),
    workspace,
    summary: summarize(workspace, generatedAt),
  };
  return { ok: true, snapshot };
}

/**
 * Parses a raw JSON string into a validated workspace snapshot. Pure; never mutates input
 * and never throws — invalid JSON returns a rejected result with the `invalid-json` code.
 */
export function parseWorkspaceSnapshotJson(
  jsonText: string
): WorkspaceSnapshotParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return {
      ok: false,
      errors: [err('invalid-json', 'The file is not valid JSON.')],
    };
  }
  return validateWorkspaceSnapshot(parsed);
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export type WorkspaceRestoreResult = {
  workspace: WorkspaceData;
  /** Resolved active selection (snapshot selection if valid, else a deterministic default). */
  selection: WorkspaceSnapshotSelection;
  summary: WorkspaceSnapshotSummary;
};

/**
 * Restores a workspace from a validated snapshot. Pure; never mutates the snapshot. Returns
 * the workspace to REPLACE the current one (never a merge) plus a resolved active selection:
 * the snapshot's selected team if it still exists, otherwise the first team of the most
 * recent season (matching the app's default-selection convention).
 */
export function restoreWorkspaceFromSnapshot(
  snapshot: WorkspaceSnapshot
): WorkspaceRestoreResult {
  const workspace: WorkspaceData = {
    districts: snapshot.workspace.districts.map(copyDistrict),
    ageDivisions: snapshot.workspace.ageDivisions.map(copyAgeDivision),
    teams: snapshot.workspace.teams.map(copyTeam),
    games: (snapshot.workspace.games ?? []).map(copyGame),
    coaches: (snapshot.workspace.coaches ?? []).map(copyStaffCoach),
    coachAssignments: (snapshot.workspace.coachAssignments ?? []).map(copyCoachAssignment),
  };

  const selection = resolveSelection(workspace.teams, snapshot.selection);
  return {
    workspace,
    selection,
    summary: summarize(workspace, snapshot.generatedAt),
  };
}

function resolveSelection(
  teams: Team[],
  requested: WorkspaceSnapshotSelection
): WorkspaceSnapshotSelection {
  // Keep the requested team only if it still exists; derive the rest from it.
  const requestedTeam =
    requested.teamId !== null
      ? teams.find((t) => t.teamId === requested.teamId) ?? null
      : null;
  if (requestedTeam) {
    return {
      seasonId: requestedTeam.seasonId,
      districtId: requestedTeam.districtId,
      ageDivisionId: requestedTeam.ageDivisionId,
      teamId: requestedTeam.teamId,
    };
  }

  // Default to the most recent season, no specific team (matches app convention of
  // auto-selecting the most recent season on load).
  const seasons = distinctSeasonIds(teams);
  const seasonId = seasons.length > 0 ? seasons[seasons.length - 1] : null;
  return { seasonId, districtId: null, ageDivisionId: null, teamId: null };
}
