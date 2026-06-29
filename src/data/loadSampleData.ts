import districtConfig from '../../data-samples/district-config.sample.json';
import rosterImport2026 from '../../data-samples/roster-import.sample.json';
import rosterImport2025 from '../../data-samples/roster-import-2025.sample.json';
import gamesSample from '../../data-samples/games.sample.json';
import type { AppData, District, Game, Team, Coach } from '../domain/types';
import { deriveCoachesAndAssignmentsFromTeams } from '../engine/coachModel';
import {
  coerceDistrictRecord,
  ensureSeedDistricts,
  buildSeededDistrictRegistry,
} from '../engine/districtRegistry';

function toCoach(raw: { name: string }): Coach {
  return { name: raw.name };
}

/**
 * Shape of a single roster import sample file. Each file represents one season,
 * matching the existing data-samples/roster-import.sample.json contract.
 */
type RosterImportFile = {
  seasonId: string;
  teams: Array<{
    teamId: string;
    districtId: string;
    ageDivisionId: string;
    teamCode: string;
    draftOrder: number;
    divisionTeamCount: number;
    headCoach: { name: string } | null;
    assistantCoaches: Array<{ name: string }>;
    players: Array<{ name: string; notes?: string }>;
  }>;
};

function teamsFromImport(rosterImport: RosterImportFile): Team[] {
  const seasonId = rosterImport.seasonId;
  return rosterImport.teams.map((t) => ({
    teamId: t.teamId,
    seasonId,
    districtId: t.districtId,
    ageDivisionId: t.ageDivisionId,
    teamCode: t.teamCode,
    draftOrder: t.draftOrder,
    divisionTeamCount: t.divisionTeamCount,
    headCoach: t.headCoach ? toCoach(t.headCoach) : null,
    assistantCoaches: t.assistantCoaches.map(toCoach),
    players: t.players.map((p) => ({
      name: p.name,
      notes: p.notes ?? undefined,
    })),
  }));
}

/**
 * Production-blocker correction (Part 3): the DEFAULT startup workspace is EMPTY — no sample
 * teams/games/coaches — so a fresh browser opens to the first-run state. The baseline
 * registries needed for import to function are preserved: the fixed age divisions and the
 * seeded district registry (so scraped district mapping still resolves the known districts).
 * The bundled sample data remains available via `loadSampleData` (tests + an explicit "Load
 * sample data" action).
 */
export function loadEmptyWorkspace(): AppData {
  return {
    districts: buildSeededDistrictRegistry(),
    ageDivisions: districtConfig.ageDivisions,
    teams: [],
    games: [],
    coaches: [],
    coachAssignments: [],
  };
}

export function loadSampleData(): AppData {
  // Each roster import file represents one season. Loading more than one season
  // lets the prior-season roster comparison render an available state for
  // same-slot teams (same district, age division, and team code) across years.
  const teams: Team[] = [
    ...teamsFromImport(rosterImport2025 as RosterImportFile),
    ...teamsFromImport(rosterImport2026 as RosterImportFile),
  ];

  // Phase 6 slice 24: schedules/results are maintained separately from roster imports.
  // Games reference existing teams as home/away participants (no opponent objects).
  const games = (gamesSample.games as Game[]).map((g) => ({ ...g }));

  // Phase 7 slice 27: derive a normalized coach/staff model from the roster-embedded coach
  // fields. Coaches are deduped by identity key across seasons/teams (e.g. a head coach who
  // returns the next year is one coach with two assignments). This never mutates rosters.
  const { coaches, coachAssignments } = deriveCoachesAndAssignmentsFromTeams(teams);

  // C1: the workspace `districts` collection IS the district registry. Coerce the sample
  // districts (defaulting a missing status to active) and ensure the known seed districts
  // are present, so scraped imports can resolve districts against a real registry.
  const sampleDistricts = districtConfig.districts
    .map(coerceDistrictRecord)
    .filter((d): d is District => d !== null);
  const districts = ensureSeedDistricts(sampleDistricts);

  return {
    districts,
    ageDivisions: districtConfig.ageDivisions,
    teams,
    games,
    coaches,
    coachAssignments,
  };
}
