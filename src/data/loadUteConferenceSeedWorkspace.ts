import seedSource from '../../data-samples/ute-conference-seed.sample.json';
import districtConfig from '../../data-samples/district-config.sample.json';
import type { AppData, District, Team } from '../domain/types';
import { buildSeededDistrictRegistry, districtIdSlug } from '../engine/districtRegistry';
import { parseTeamClassification } from '../engine/teamClassification';

/**
 * Production-blocker correction (seed direction): builds the Ute Conference BASELINE seed
 * workspace — a registry of the known Ute Conference districts + fixed age divisions + EMPTY
 * team shells — so real player rosters can be imported into existing teams via the current
 * import pipeline (no dynamic team creation on import).
 *
 * This is a clean, deterministic workspace builder over the committed seed-source fixture
 * (`data-samples/ute-conference-seed.sample.json`) — NOT a runtime scrape parser. Team shells
 * carry no players and no coaches; `draftOrder`/`divisionTeamCount` are internally consistent
 * per district + age division. Districts already in the seeded registry (Alta, Brighton) keep
 * their real branding; the rest are created deterministically with provisional blank branding
 * (`brandingProvisional: true`). Distinct from `loadEmptyWorkspace` (no teams) and
 * `loadSampleData` (demo content).
 */

type SeedSeason = {
  seasonId: string;
  teamCodesByAgeDivision: Record<string, string[]>;
};

type SeedSource = {
  districtNames: string[];
  seasons: SeedSeason[];
};

const SEED = seedSource as SeedSource;

/** A provisional district record for a seeded district with no confirmed branding yet. */
function provisionalDistrict(name: string): District {
  return {
    districtId: districtIdSlug(name),
    name,
    mascot: '',
    logoAssetPath: '',
    helmetAssetPath: '',
    primaryColor: '',
    secondaryColor: '',
    status: 'active',
    sourceLabels: [name],
    brandingProvisional: true,
  };
}

/**
 * Builds the district registry for the seed: every name in the fixture, deterministic
 * `districtIdSlug` id, first-seen order, de-duplicated. Districts already in the seeded
 * registry keep their real branding; the rest get provisional blank branding.
 */
function buildSeedDistricts(): District[] {
  const seeded = new Map(buildSeededDistrictRegistry().map((d) => [d.districtId, d] as const));
  const districts: District[] = [];
  const seen = new Set<string>();
  for (const name of SEED.districtNames) {
    const districtId = districtIdSlug(name);
    if (seen.has(districtId)) continue;
    seen.add(districtId);
    districts.push(seeded.get(districtId) ?? provisionalDistrict(name));
  }
  return districts;
}

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
 * Builds the Ute Conference seed workspace. Pure and deterministic. Only age divisions present
 * in the fixed list and codes that parse as valid classifications are included, so every team
 * reference is valid. Iterates season -> age division (fixed order) -> district -> code.
 */
export function loadUteConferenceSeedWorkspace(): AppData {
  const districts = buildSeedDistricts();
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
