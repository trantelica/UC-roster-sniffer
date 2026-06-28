import type { District } from '../domain/types';

/**
 * The deterministic SEED district registry of the known Ute Conference districts.
 *
 * Districts are CORE INFRASTRUCTURE, not roster content: this full registry is the default
 * starting registry for a fresh empty workspace (`loadEmptyWorkspace`), so a real Ute
 * Conference roster file can CREATE teams immediately without first loading any seed. (Teams
 * are still created by roster import — this seeds districts only, no teams.)
 *
 * Branding rules:
 * - We do NOT invent authoritative mascots/colors/logos. Alta and Brighton reuse the values
 *   already present in `data-samples/district-config.sample.json` (repo data), so their
 *   branding is real and NOT flagged `brandingProvisional`.
 * - Every other known district is seeded ACTIVE with explicit blank/provisional branding
 *   (`brandingProvisional: true`) for later fill-in via District Maintenance.
 * - `sourceLabels` carries the exact scraped district name for EXACT import matching (never
 *   fuzzy); distinct districts (e.g. "Bingham" vs "Bingham Girls") are never collapsed.
 */

/**
 * Local id slug. Kept local so this plain-data module has no dependency on the engine (which
 * imports this module). It MUST stay equal to `districtIdSlug` in
 * `src/engine/districtRegistry.ts` — a test asserts `districtIdSlug(name) === seed.districtId`
 * for every seed district to guard against drift.
 */
function seedDistrictId(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'district' : slug;
}

/** Confirmed-branding districts (repo data), keyed by name. */
const CONFIRMED_BRANDING: Record<string, Pick<District, 'mascot' | 'logoAssetPath' | 'helmetAssetPath' | 'primaryColor' | 'secondaryColor'>> = {
  Alta: {
    mascot: 'Hawks',
    logoAssetPath: 'assets/districts/alta/logo.png',
    helmetAssetPath: 'assets/districts/alta/helmet.png',
    primaryColor: '#000000',
    secondaryColor: '#FFFFFF',
  },
  Brighton: {
    mascot: 'Bengals',
    logoAssetPath: 'assets/districts/brighton/logo.png',
    helmetAssetPath: 'assets/districts/brighton/helmet.png',
    primaryColor: '#003366',
    secondaryColor: '#FF6600',
  },
};

/** All known Ute Conference district names (the default registry), in stable order. */
export const UTE_CONFERENCE_DISTRICT_NAMES: string[] = [
  'Alta',
  'Bingham',
  'Bountiful',
  'Brighton',
  'Cedar Valley',
  'Clearfield',
  'Copper Hills',
  'Corner Canyon',
  'Cyprus',
  'Deseret Peak',
  'East',
  'Farmington',
  'Fremont',
  'Grantsville',
  'Herriman',
  'Highland',
  'Hunter',
  'Juan Diego',
  'Kearns',
  'Mountain Ridge',
  'Murray',
  'Northridge',
  'Olympus',
  'Orem',
  'Park City',
  'Riverton',
  'Skyline',
  'South Summit',
  'Stansbury',
  'Syracuse',
  'Taylorsville',
  'Tooele',
  'Viewmont',
  'Wasatch',
  'Weber',
  'West',
  'West Field',
  'West Jordan',
  'Woods Cross',
];

function buildSeedDistrict(name: string): District {
  const confirmed = CONFIRMED_BRANDING[name];
  if (confirmed) {
    return {
      districtId: seedDistrictId(name),
      name,
      ...confirmed,
      status: 'active',
      sourceLabels: [name],
      brandingProvisional: false,
    };
  }
  return {
    districtId: seedDistrictId(name),
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

/** The full seeded district registry (39 known districts; all active). */
export const UTE_CONFERENCE_DISTRICT_SEED: District[] =
  UTE_CONFERENCE_DISTRICT_NAMES.map(buildSeedDistrict);
