import type { District, DistrictStatus, Team } from '../domain/types';
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

/**
 * What confirming did:
 * - `reused`     — an EXACT ACTIVE match already existed; nothing changed (idempotent).
 * - `reactivated`— the only EXACT match(es) were inactive; the existing record was flipped
 *                  back to active (preserved, never duplicated or deleted).
 * - `added`      — no exact match existed; a new active/provisional record was appended.
 */
export type ConfirmScrapedDistrictOutcome = 'reused' | 'reactivated' | 'added';

export type ConfirmScrapedDistrictResult = {
  /** The registry after the confirm (new array; input never mutated). */
  districts: District[];
  /** The matched-or-created district record (always active after a confirm). */
  district: District;
  /** What confirming did. */
  outcome: ConfirmScrapedDistrictOutcome;
  /** True when `districts` differs from the input (i.e. `reactivated` or `added`). */
  changed: boolean;
};

/**
 * Confirms an unknown scraped district name into the registry, always yielding an ACTIVE
 * registry outcome so the import workbench can re-derive a high-confidence mapping:
 *
 * - An EXACT ACTIVE match is reused as-is (idempotent, nothing changes).
 * - When the ONLY exact match(es) are INACTIVE, the existing inactive record is REACTIVATED
 *   (status flipped to active). We reactivate rather than append a competing duplicate so a
 *   previously-retired district is not fragmented into two records for the same label, and
 *   the record (and any branding) is preserved — districts are never deleted. The scraped
 *   label already matches that record's `name`/`sourceLabels`, so the lookup resolves it.
 * - When there is NO exact match, a new ACTIVE record is appended with a deterministic id
 *   (the name slug, disambiguated on collision), the exact scraped name preserved, the
 *   scraped name recorded as a source label, and placeholder branding
 *   (`brandingProvisional: true`).
 *
 * Matching is EXACT only (no fuzzy matching); pure (never mutates the input).
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
    return { districts: [...districts], district: placeholder, outcome: 'reused', changed: false };
  }

  const existing = findDistrictByExactName(districts, name);
  if (existing && isDistrictActive(existing)) {
    return { districts: [...districts], district: existing, outcome: 'reused', changed: false };
  }
  if (existing) {
    // Only an inactive exact match exists: reactivate it (never a silent no-op).
    const district: District = { ...existing, status: 'active' };
    const next = districts.map((d) =>
      d.districtId === existing.districtId ? district : d
    );
    return { districts: next, district, outcome: 'reactivated', changed: true };
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
  return { districts: [...districts, district], district, outcome: 'added', changed: true };
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

// ---------------------------------------------------------------------------
// Reactivate (mirror of inactivate; never deletes, never changes the id)
// ---------------------------------------------------------------------------

export type ReactivateDistrictResult =
  | { changed: true; districts: District[]; district: District }
  | { changed: false; reason: 'not-found' | 'already-active'; districts: District[] };

/**
 * Marks an inactive district active again, preserving the SAME districtId and every other
 * field. Returns `changed: false` when the id is unknown or already active. Pure; never
 * mutates the input.
 */
export function reactivateDistrict(
  districts: District[],
  districtId: string
): ReactivateDistrictResult {
  const target = findDistrictById(districts, districtId);
  if (!target) return { changed: false, reason: 'not-found', districts: [...districts] };
  if (isDistrictActive(target)) {
    return { changed: false, reason: 'already-active', districts: [...districts] };
  }
  const district: District = { ...target, status: 'active' };
  const next = districts.map((d) => (d.districtId === districtId ? district : d));
  return { changed: true, districts: next, district };
}

// ---------------------------------------------------------------------------
// District Maintenance (C2): create / edit + supporting helpers
// ---------------------------------------------------------------------------

/**
 * Normalizes a free-text (user-entered) source-label list for District Maintenance: trims
 * each entry, drops blanks, and dedupes exactly (after trimming). Distinct from the snapshot
 * `coerceSourceLabels`, which preserves stored values verbatim for round-trip fidelity.
 */
export function normalizeSourceLabels(labels: readonly unknown[] | undefined): string[] {
  if (!Array.isArray(labels)) return [];
  const out: string[] = [];
  for (const entry of labels) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed !== '' && !out.includes(trimmed)) out.push(trimmed);
  }
  return out;
}

/** True when a district's branding (colors) is incomplete/placeholder-like. */
function brandingIsIncomplete(input: {
  primaryColor?: string;
  secondaryColor?: string;
}): boolean {
  return (
    presentString(input.primaryColor) === null ||
    presentString(input.secondaryColor) === null
  );
}

export type DistrictMaintenanceInput = {
  name: string;
  mascot?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoAssetPath?: string;
  helmetAssetPath?: string;
  /** Exact import aliases. When omitted/empty, defaults to `[name]` on create. */
  sourceLabels?: string[];
  /** When omitted, defaults to true unless both brand colors are present. */
  brandingProvisional?: boolean;
};

export type DistrictInputValidationError = 'missing-name' | 'missing-mascot';

/**
 * Validates the required District Maintenance fields (name + mascot). Colors and image
 * references are optional (image refs are plain strings only; never bytes). Pure.
 */
export function validateDistrictInput(
  input: DistrictMaintenanceInput
): DistrictInputValidationError[] {
  const errors: DistrictInputValidationError[] = [];
  if (presentString(input.name) === null) errors.push('missing-name');
  if (presentString(input.mascot) === null) errors.push('missing-mascot');
  return errors;
}

export type CreateDistrictResult = {
  districts: District[];
  district: District;
};

/**
 * Creates a new ACTIVE district from user input and appends it to the registry. The
 * districtId is generated deterministically from the name slug, disambiguated on collision
 * (the same scheme `confirmUnknownScrapedDistrict` uses) — the caller never types an id.
 * `sourceLabels` default to `[name]` when none are supplied; `brandingProvisional` defaults
 * to true unless both brand colors are present. Image references are stored as plain strings.
 * Pure; never mutates the input. Assumes the input already passed `validateDistrictInput`.
 */
export function createDistrictFromInput(
  districts: District[],
  input: DistrictMaintenanceInput
): CreateDistrictResult {
  const name = (presentString(input.name) ?? '').trim();
  const districtId = nextAvailableDistrictId(districts, name);
  const labels = normalizeSourceLabels(input.sourceLabels);
  const sourceLabels = labels.length > 0 ? labels : [name];
  const brandingProvisional =
    input.brandingProvisional ?? brandingIsIncomplete(input);

  const district: District = {
    districtId,
    name,
    mascot: (input.mascot ?? '').trim(),
    logoAssetPath: (input.logoAssetPath ?? '').trim(),
    helmetAssetPath: (input.helmetAssetPath ?? '').trim(),
    primaryColor: (input.primaryColor ?? '').trim(),
    secondaryColor: (input.secondaryColor ?? '').trim(),
    status: 'active',
    sourceLabels,
    brandingProvisional,
  };
  return { districts: [...districts, district], district };
}

/** Editable fields for an existing district (districtId and status are NOT editable here). */
export type DistrictUpdatePatch = {
  name?: string;
  mascot?: string;
  primaryColor?: string;
  secondaryColor?: string;
  logoAssetPath?: string;
  helmetAssetPath?: string;
  sourceLabels?: string[];
  brandingProvisional?: boolean;
};

export type UpdateDistrictResult =
  | { changed: true; districts: District[]; district: District }
  | { changed: false; reason: 'not-found'; districts: District[] };

/**
 * Updates the mutable fields of an existing district IN PLACE (same districtId, same status —
 * use {@link inactivateDistrict} / {@link reactivateDistrict} for status). Only provided
 * fields are changed; `sourceLabels`, when provided, are trimmed/de-duped (blank entries
 * removed) and matched EXACTLY (no fuzzy aliases). Pure; never mutates the input and never
 * deletes a district or rewrites any team's districtId reference.
 */
export function updateDistrict(
  districts: District[],
  districtId: string,
  patch: DistrictUpdatePatch
): UpdateDistrictResult {
  const target = findDistrictById(districts, districtId);
  if (!target) return { changed: false, reason: 'not-found', districts: [...districts] };

  const district: District = { ...target };
  if (patch.name !== undefined) district.name = patch.name.trim();
  if (patch.mascot !== undefined) district.mascot = patch.mascot.trim();
  if (patch.primaryColor !== undefined) district.primaryColor = patch.primaryColor.trim();
  if (patch.secondaryColor !== undefined) {
    district.secondaryColor = patch.secondaryColor.trim();
  }
  if (patch.logoAssetPath !== undefined) district.logoAssetPath = patch.logoAssetPath.trim();
  if (patch.helmetAssetPath !== undefined) {
    district.helmetAssetPath = patch.helmetAssetPath.trim();
  }
  if (patch.sourceLabels !== undefined) {
    district.sourceLabels = normalizeSourceLabels(patch.sourceLabels);
  }
  if (patch.brandingProvisional !== undefined) {
    district.brandingProvisional = patch.brandingProvisional;
  }
  const next = districts.map((d) => (d.districtId === districtId ? district : d));
  return { changed: true, districts: next, district };
}

/** True when any team references this districtId (used to warn before inactivation). */
export function isDistrictReferencedByTeams(
  teams: Team[],
  districtId: string
): boolean {
  return teams.some((t) => t.districtId === districtId);
}

/** Number of teams that reference this districtId. */
export function countTeamsForDistrict(teams: Team[], districtId: string): number {
  return teams.reduce((n, t) => (t.districtId === districtId ? n + 1 : n), 0);
}
