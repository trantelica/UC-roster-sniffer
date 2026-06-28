import type { District } from '../domain/types';

/**
 * Completion Milestone C1: the deterministic SEED list of known Ute Conference districts.
 *
 * This is plain data (not React, not persistence). It is the canonical starting registry
 * that `ensureSeedDistricts` merges into a workspace without duplicating existing records.
 * The list is intentionally small and safely EXPANDABLE later via the C2 District
 * Maintenance utility.
 *
 * Branding rules (locked):
 * - We do NOT invent authoritative mascots/colors/logos. The two districts below reuse the
 *   values already present in `data-samples/district-config.sample.json` (repo data), so
 *   their branding is real, not invented, and is NOT flagged `brandingProvisional`.
 * - When a future seed district has no authoritative branding, give it explicit placeholder
 *   values and set `brandingProvisional: true` so it is clearly marked for later fill-in.
 * - `sourceLabels` carries the exact scraped district name(s) that should resolve to the
 *   record. Matching is EXACT only (never fuzzy); distinct districts such as "Bingham" and
 *   "Bingham Girls" are never collapsed.
 */
export const UTE_CONFERENCE_DISTRICT_SEED: District[] = [
  {
    districtId: 'alta',
    name: 'Alta',
    mascot: 'Hawks',
    logoAssetPath: 'assets/districts/alta/logo.png',
    helmetAssetPath: 'assets/districts/alta/helmet.png',
    primaryColor: '#000000',
    secondaryColor: '#FFFFFF',
    status: 'active',
    sourceLabels: ['Alta'],
    brandingProvisional: false,
  },
  {
    districtId: 'brighton',
    name: 'Brighton',
    mascot: 'Bengals',
    logoAssetPath: 'assets/districts/brighton/logo.png',
    helmetAssetPath: 'assets/districts/brighton/helmet.png',
    primaryColor: '#003366',
    secondaryColor: '#FF6600',
    status: 'active',
    sourceLabels: ['Brighton'],
    brandingProvisional: false,
  },
];
