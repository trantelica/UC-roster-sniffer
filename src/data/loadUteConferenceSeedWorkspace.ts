import seedSource from '../../data-samples/ute-conference-seed.sample.json';
import districtConfig from '../../data-samples/district-config.sample.json';
import type { AppData, District, Team } from '../domain/types';
import { buildSeededDistrictRegistry } from '../engine/districtRegistry';
import { parseTeamClassification } from '../engine/teamClassification';

/**
 * Production-blocker correction (seed direction): builds the Ute Conference BASELINE seed
 * workspace — the seeded district registry + fixed age divisions + EMPTY team shells — so real
 * player rosters can be imported into existing teams via the current import pipeline (no
 * dynamic team creation on import).
 *
 * This is a clean, deterministic workspace builder over the committed seed-source fixture
 * (`data-samples/ute-conference-seed.sample.json`) — NOT a runtime scrape parser. Team shells
 * carry no players and no coaches; analytics-relevant fields (`draftOrder`,
 * `divisionTeamCount`) are internally consistent (per district + age division). It is distinct
 * from `loadEmptyWorkspace` (no teams) and `loadSampleData` (demo content).
 */

type SeedSource = {
  seasonId: string;
  districtIds: string[];
  teamCodesByAgeDivision: Record<string, string[]>;
};

const SEED = seedSource as SeedSource;

/**
 * Builds the Ute Conference seed workspace. Pure and deterministic. Only districts present in
 * the seeded registry, age divisions present in the fixed list, and codes that parse as valid
 * team classifications are included, so every team reference is valid.
 */
export function loadUteConferenceSeedWorkspace(): AppData {
  const districts: District[] = buildSeededDistrictRegistry();
  const ageDivisions = districtConfig.ageDivisions;

  const districtIdSet = new Set(districts.map((d) => d.districtId));
  const seasonId = SEED.seasonId;

  const teams: Team[] = [];
  for (const districtId of SEED.districtIds) {
    if (!districtIdSet.has(districtId)) continue; // never reference an unknown district
    for (const ageDivision of ageDivisions) {
      const ageDivisionId = ageDivision.ageDivisionId;
      const codes = SEED.teamCodesByAgeDivision[ageDivisionId] ?? [];
      const validCodes = codes.filter(isValidTeamCode);
      validCodes.forEach((teamCode, index) => {
        teams.push({
          teamId: `${seasonId}-${districtId}-${ageDivisionId}-${teamCode}`,
          seasonId,
          districtId,
          ageDivisionId,
          teamCode,
          draftOrder: index + 1,
          divisionTeamCount: validCodes.length,
          headCoach: null,
          assistantCoaches: [],
          players: [],
        });
      });
    }
  }

  return {
    districts,
    ageDivisions,
    teams,
    games: [],
    coaches: [],
    coachAssignments: [],
  };
}

/** True when a team code parses as a supported classification (e.g. A1, B2, C1, D2). */
function isValidTeamCode(code: string): boolean {
  try {
    parseTeamClassification(code);
    return true;
  } catch {
    return false;
  }
}
