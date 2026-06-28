import type { District, DistrictStatus } from '../domain/types';
import { UTE_CONFERENCE_DISTRICT_SEED } from '../data/districtRegistrySeed';

/**
 * Completion Milestone C1/C3: PURE, deterministic helpers for the canonical DISTRICT
 * REGISTRY — ENGINE ONLY.
 *
 * The registry IS the workspace's `districts` collection (there is no competing second
 * district system). These helpers validate/coerce district records, default a missing
 * `status` to `active`, build the seeded registry, ensure seeds without duplicating,
 * find active/inactive districts, find by id, find by EXACT name/source label, confirm an
 * unknown scraped district into the registry as active/provisional, and inactivate a
 * district — but NEVER hard-delete one.
 *
 * Guardrails: every helper is pure and never mutates its inputs (it returns new arrays /
 * records). Matching is EXACT only — there is NO fuzzy matching and distinct districts
 * (e.g. "Bingham" vs "Bingham Girls") are never collapsed. There is deliberately no
 * delete helper: inactivation is the only retirement path.
 */

export const DISTRICT_REGISTRY_LOGIC_VERSION = 'milestoneC1-district-registry-v1';

/** Placeholder branding used for a district confirmed/added during import (C3). */
export const PLACEHOLDER_DISTRICT_BRANDING = {
  mascot: 'TBD',
  logoAssetPath: '',
  helmetAssetPath: '',
  primaryColor: '#202419',
  secondaryColor: '#EBE9E9',
} as const;

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function presentString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.trim() === '' ? null : value;
}

/** Deterministic id slug (mirrors the scraped canonical mapping's provisional slug). */
export function districtIdSlug(value: unknown): string {
  const s = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s === '' ? 'district' : s;
}

/** Normalizes a `status`-like value, defaulting anything but `inactive` to `active`. */
export function coerceDistrictStatus(value: unknown): DistrictStatus {
  return value === 'inactive' ? 'inactive' : 'active';
}

/**
 * A district is active unless it is explicitly `inactive`. An absent status (older
 * snapshots / sample data without the field) counts as active.
 */
export function isDistrictActive(district: District): boolean {
  return district.status !== 'inactive';
}

// ---------------------------------------------------------------------------
// Validate / coerce
// ---------------------------------------------------------------------------

/**
 * Validates and coerces an unknown value into a District record, defaulting a missing
 * `status` to `active` and dropping malformed optional fields. Returns null when the
 * required `districtId`/`name` are missing. Pure; never mutates the input.
 */
export function coerceDistrictRecord(value: unknown): District | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const districtId = presentString(raw.districtId);
  if (districtId === null || typeof raw.name !== 'string') return null;

  const district: District = {
    districtId,
    name: raw.name,
    mascot: typeof raw.mascot === 'string' ? raw.mascot : '',
    logoAssetPath: typeof raw.logoAssetPath === 'string' ? raw.logoAssetPath : '',
    helmetAssetPath: typeof raw.helmetAssetPath === 'string' ? raw.helmetAssetPath : '',
    primaryColor: typeof raw.primaryColor === 'string' ? raw.primaryColor : '',
    secondaryColor: typeof raw.secondaryColor === 'string' ? raw.secondaryColor : '',
    status: coerceDistrictStatus(raw.status),
  };
  const sourceLabels = coerceSourceLabels(raw.sourceLabels);
  if (sourceLabels.length > 0) district.sourceLabels = sourceLabels;
  if (typeof raw.brandingProvisional === 'boolean') {
    district.brandingProvisional = raw.brandingProvisional;
  }
  return district;
}

function coerceSourceLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const label = presentString(entry);
    if (label !== null && !out.includes(label)) out.push(label);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/** Builds a fresh copy of the seeded registry. Pure; callers get their own array/records. */
export function buildSeededDistrictRegistry(): District[] {
  return UTE_CONFERENCE_DISTRICT_SEED.map((d) => ({
    ...d,
    sourceLabels: d.sourceLabels ? [...d.sourceLabels] : undefined,
  }));
}

/**
 * Returns `existing` with any seed districts that are MISSING (by `districtId`) appended.
 * Existing records are preserved exactly and never overwritten, so a user's edits/inactive
 * status are kept. Pure; never mutates the input.
 */
export function ensureSeedDistricts(existing: District[]): District[] {
  const knownIds = new Set(existing.map((d) => d.districtId));
  const additions = buildSeededDistrictRegistry().filter(
    (seed) => !knownIds.has(seed.districtId)
  );
  return additions.length === 0 ? [...existing] : [...existing, ...additions];
}

// ---------------------------------------------------------------------------
// Find
// ---------------------------------------------------------------------------

export function findActiveDistricts(districts: District[]): District[] {
  return districts.filter(isDistrictActive);
}

export function findInactiveDistricts(districts: District[]): District[] {
  return districts.filter((d) => !isDistrictActive(d));
}

export function findDistrictById(
  districts: District[],
  districtId: string
): District | null {
  return districts.find((d) => d.districtId === districtId) ?? null;
}

/**
 * Finds a district whose `name` or one of its `sourceLabels` EXACTLY equals `label`.
 * Active matches are preferred over inactive ones; among same-status matches the first in
 * source order wins. No fuzzy matching, no normalization, no collapsing of distinct names.
 */
export function findDistrictByExactName(
  districts: District[],
  label: string
): District | null {
  const matches = districts.filter(
    (d) => d.name === label || (d.sourceLabels?.includes(label) ?? false)
  );
  if (matches.length === 0) return null;
  return matches.find(isDistrictActive) ?? matches[0];
}

/**
 * Builds the exact-name lookup (`name`/`sourceLabel` -> districtId) consumed by the scraped
 * canonical mapping. Only ACTIVE districts are included, so inactive districts are never
 * preferred for new import mapping. When an active and inactive district share a label, the
 * active one wins (only active districts are added). Pure; never mutates the input.
 */
export function buildDistrictNameRegistryLookup(
  districts: District[]
): Record<string, string> {
  const lookup: Record<string, string> = {};
  for (const district of findActiveDistricts(districts)) {
    const labels = [district.name, ...(district.sourceLabels ?? [])];
    for (const label of labels) {
      if (presentString(label) === null) continue;
      // First active district to claim a label wins (deterministic, source order).
      if (!(label in lookup)) lookup[label] = district.districtId;
    }
  }
  return lookup;
}

// ---------------------------------------------------------------------------
// Confirm an unknown scraped district
// ---------------------------------------------------------------------------

export type ConfirmScrapedDistrictResult = {
  /** The registry after the confirm (new array; input never mutated). */
  districts: District[];
  /** The matched-or-created district record. */
  district: District;
  /** True when a new record was appended; false when an existing exact match was reused. */
  added: boolean;
};

/**
 * Confirms an unknown scraped district name into the registry. If an EXACT name/source-label
 * match already exists it is reused (idempotent, nothing added). Otherwise a new ACTIVE
 * record is appended with a deterministic id (the name slug, disambiguated on collision),
 * the exact scraped name preserved, the scraped name recorded as a source label, and
 * placeholder/provisional branding (`brandingProvisional: true`). Pure; never mutates input.
 */
export function confirmUnknownScrapedDistrict(
  districts: District[],
  scrapedName: string
): ConfirmScrapedDistrictResult {
  const name = presentString(scrapedName);
  if (name === null) {
    // Nothing usable to confirm; return the registry unchanged with a no-op record.
    const placeholder: District = {
      districtId: 'district',
      name: '',
      ...PLACEHOLDER_DISTRICT_BRANDING,
      status: 'active',
      brandingProvisional: true,
    };
    return { districts: [...districts], district: placeholder, added: false };
  }

  const existing = findDistrictByExactName(districts, name);
  if (existing) {
    return { districts: [...districts], district: existing, added: false };
  }

  const districtId = nextAvailableDistrictId(districts, name);
  const district: District = {
    districtId,
    name,
    ...PLACEHOLDER_DISTRICT_BRANDING,
    status: 'active',
    sourceLabels: [name],
    brandingProvisional: true,
  };
  return { districts: [...districts, district], district, added: true };
}

/** Deterministic id derived from the name slug, suffixed only on a collision. */
function nextAvailableDistrictId(districts: District[], name: string): string {
  const base = districtIdSlug(name);
  const taken = new Set(districts.map((d) => d.districtId));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

// ---------------------------------------------------------------------------
// Inactivate (the ONLY retirement path — never delete)
// ---------------------------------------------------------------------------

export type InactivateDistrictResult =
  | { changed: true; districts: District[]; district: District }
  | { changed: false; reason: 'not-found' | 'already-inactive'; districts: District[] };

/**
 * Marks a district inactive (the only retirement path; the record is preserved, never
 * removed). Returns `changed: false` when the id is unknown or already inactive. Pure;
 * never mutates the input.
 */
export function inactivateDistrict(
  districts: District[],
  districtId: string
): InactivateDistrictResult {
  const target = findDistrictById(districts, districtId);
  if (!target) return { changed: false, reason: 'not-found', districts: [...districts] };
  if (!isDistrictActive(target)) {
    return { changed: false, reason: 'already-inactive', districts: [...districts] };
  }
  const district: District = { ...target, status: 'inactive' };
  const next = districts.map((d) => (d.districtId === districtId ? district : d));
  return { changed: true, districts: next, district };
}
