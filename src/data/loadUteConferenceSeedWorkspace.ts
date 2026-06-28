import seedSource from '../../data-samples/ute-conference-seed.sample.json';
import districtConfig from '../../data-samples/district-config.sample.json';
import type { AppData, Team } from '../domain/types';
import { buildSeededDistrictRegistry } from '../engine/districtRegistry';
import { parseTeamClassification } from '../engine/teamClassification';

/**
 * OPTIONAL Ute Conference baseline seed workspace: the full seeded district registry + fixed
 * age divisions + EMPTY team shells. Since roster import now CREATES teams, the known districts
 * already live in the default registry (`loadEmptyWorkspace`), so this seed is no longer
 * REQUIRED for basic roster import — it's a convenience that pre-creates a set of empty team
 * shells (which a roster import then UPDATES instead of creating).
 *
 * This is a clean, deterministic workspace builder over the committed seed-source fixture
 * (`data-samples/ute-conference-seed.sample.json`) — NOT a runtime scrape parser. Team shells
 * carry no players and no coaches; `draftOrder`/`divisionTeamCount` are internally consistent
 * per district + age division. Districts come from the seeded registry (Alta/Brighton keep
 * their real branding; the rest are provisional). Distinct from `loadEmptyWorkspace` (no teams)
 * and `loadSampleData` (demo content).
 */

type SeedSeason = {
  seasonId: string;
  teamCodesByAgeDivision: Record<string, string[]>;
};

type SeedSource = {
  seasons: SeedSeason[];
};

const SEED = seedSource as SeedSource;

/** True when a team code parses as a supported classification (e.g. A1, B4, C2, D2). */
function isValidTeamCode(code: string): boolean {
  try {
    parseTeamClassification(code);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the Ute Conference seed workspace. Pure and deterministic. Districts come from the
 * default seeded registry; only fixed age divisions and codes that parse as valid
 * classifications produce shells. Iterates season -> age division (fixed order) -> district ->
 * code.
 */
export function loadUteConferenceSeedWorkspace(): AppData {
  const districts = buildSeededDistrictRegistry();
  const ageDivisions = districtConfig.ageDivisions;
  const ageOrder = ageDivisions.map((a) => a.ageDivisionId);

  const teams: Team[] = [];
  for (const season of SEED.seasons) {
    for (const ageDivisionId of ageOrder) {
      const codes = (season.teamCodesByAgeDivision[ageDivisionId] ?? []).filter(isValidTeamCode);
      if (codes.length === 0) continue;
      for (const district of districts) {
        codes.forEach((teamCode, index) => {
          teams.push({
            teamId: `${season.seasonId}-${district.districtId}-${ageDivisionId}-${teamCode}`,
            seasonId: season.seasonId,
            districtId: district.districtId,
            ageDivisionId,
            teamCode,
            draftOrder: index + 1,
            divisionTeamCount: codes.length,
            headCoach: null,
            assistantCoaches: [],
            players: [],
          });
        });
      }
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
