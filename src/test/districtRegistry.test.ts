import { describe, it, expect } from 'vitest';
import type { District } from '../domain/types';
import {
  buildSeededDistrictRegistry,
  ensureSeedDistricts,
  coerceDistrictRecord,
  coerceDistrictStatus,
  isDistrictActive,
  findActiveDistricts,
  findInactiveDistricts,
  findDistrictById,
  findDistrictByExactName,
  buildDistrictNameRegistryLookup,
  confirmUnknownScrapedDistrict,
  inactivateDistrict,
} from '../engine/districtRegistry';

function freeze<T>(value: T): T {
  return Object.freeze(value) as T;
}

function district(overrides: Partial<District>): District {
  return {
    districtId: 'x',
    name: 'X',
    mascot: '',
    logoAssetPath: '',
    helmetAssetPath: '',
    primaryColor: '',
    secondaryColor: '',
    ...overrides,
  };
}

describe('district registry seed', () => {
  it('is deterministic across calls (equal value, fresh references)', () => {
    const a = buildSeededDistrictRegistry();
    const b = buildSeededDistrictRegistry();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });

  it('every seed district has the required fields and an explicit active status', () => {
    for (const d of buildSeededDistrictRegistry()) {
      expect(typeof d.districtId).toBe('string');
      expect(d.districtId.length).toBeGreaterThan(0);
      expect(typeof d.name).toBe('string');
      expect(typeof d.mascot).toBe('string');
      expect(typeof d.primaryColor).toBe('string');
      expect(typeof d.secondaryColor).toBe('string');
      expect(typeof d.logoAssetPath).toBe('string');
      expect(typeof d.helmetAssetPath).toBe('string');
      expect(d.status).toBe('active');
    }
  });

  it('seeds the known Ute Conference districts (Alta, Brighton)', () => {
    const ids = buildSeededDistrictRegistry().map((d) => d.districtId);
    expect(ids).toContain('alta');
    expect(ids).toContain('brighton');
  });
});

describe('status coercion / active default', () => {
  it('defaults a missing or unknown status to active', () => {
    expect(coerceDistrictStatus(undefined)).toBe('active');
    expect(coerceDistrictStatus(null)).toBe('active');
    expect(coerceDistrictStatus('nonsense')).toBe('active');
    expect(coerceDistrictStatus('active')).toBe('active');
    expect(coerceDistrictStatus('inactive')).toBe('inactive');
  });

  it('treats a district with no status as active', () => {
    expect(isDistrictActive(district({ status: undefined }))).toBe(true);
    expect(isDistrictActive(district({ status: 'active' }))).toBe(true);
    expect(isDistrictActive(district({ status: 'inactive' }))).toBe(false);
  });

  it('coerceDistrictRecord defaults missing status to active and drops junk', () => {
    const r = coerceDistrictRecord({ districtId: 'alta', name: 'Alta' });
    expect(r?.status).toBe('active');
    expect(coerceDistrictRecord({ name: 'no id' })).toBeNull();
    expect(coerceDistrictRecord(null)).toBeNull();
    expect(coerceDistrictRecord({ districtId: 'a', name: 'A', sourceLabels: ['L', 5, ''] })?.sourceLabels).toEqual(['L']);
  });
});

describe('ensureSeedDistricts', () => {
  it('appends only missing seeds and never duplicates existing ids', () => {
    const existing = [district({ districtId: 'alta', name: 'Alta', status: 'inactive' })];
    const result = ensureSeedDistricts(existing);
    const ids = result.map((d) => d.districtId);
    expect(ids.filter((id) => id === 'alta')).toHaveLength(1);
    expect(ids).toContain('brighton');
    // The existing record (including its inactive status) is preserved, not overwritten.
    expect(findDistrictById(result, 'alta')?.status).toBe('inactive');
  });

  it('does not mutate the input array', () => {
    const existing = freeze([district({ districtId: 'keep', name: 'Keep' })]);
    const result = ensureSeedDistricts(existing);
    expect(existing).toHaveLength(1);
    expect(result.length).toBeGreaterThan(1);
  });
});

describe('finders', () => {
  const districts = [
    district({ districtId: 'alta', name: 'Alta', status: 'active' }),
    district({ districtId: 'old', name: 'Old', status: 'inactive' }),
    district({ districtId: 'bingham', name: 'Bingham', status: 'active', sourceLabels: ['Bingham', 'Bingham HS'] }),
    district({ districtId: 'bingham-girls', name: 'Bingham Girls', status: 'active' }),
  ];

  it('finds active and inactive districts (preserving, not removing, inactive)', () => {
    expect(findActiveDistricts(districts).map((d) => d.districtId)).toEqual([
      'alta',
      'bingham',
      'bingham-girls',
    ]);
    expect(findInactiveDistricts(districts).map((d) => d.districtId)).toEqual(['old']);
    // Inactive record is still present in the source registry.
    expect(findDistrictById(districts, 'old')).not.toBeNull();
  });

  it('finds by id', () => {
    expect(findDistrictById(districts, 'alta')?.name).toBe('Alta');
    expect(findDistrictById(districts, 'nope')).toBeNull();
  });

  it('matches by exact name or exact source label, never fuzzy', () => {
    expect(findDistrictByExactName(districts, 'Alta')?.districtId).toBe('alta');
    expect(findDistrictByExactName(districts, 'Bingham HS')?.districtId).toBe('bingham');
    // Distinct names are never collapsed.
    expect(findDistrictByExactName(districts, 'Bingham Girls')?.districtId).toBe('bingham-girls');
    // Near matches do not match.
    expect(findDistrictByExactName(districts, 'alta')).toBeNull();
    expect(findDistrictByExactName(districts, 'Alt')).toBeNull();
    expect(findDistrictByExactName(districts, 'Bingham ')).toBeNull();
  });

  it('prefers an active match over an inactive same-name match', () => {
    const withDup = [
      district({ districtId: 'a-old', name: 'Acme', status: 'inactive' }),
      district({ districtId: 'a-new', name: 'Acme', status: 'active' }),
    ];
    expect(findDistrictByExactName(withDup, 'Acme')?.districtId).toBe('a-new');
  });
});

describe('buildDistrictNameRegistryLookup', () => {
  it('maps active district names and source labels to ids, excluding inactive', () => {
    const districts = [
      district({ districtId: 'alta', name: 'Alta', sourceLabels: ['Alta', 'Alta District'] }),
      district({ districtId: 'old', name: 'Old', status: 'inactive' }),
    ];
    const lookup = buildDistrictNameRegistryLookup(districts);
    expect(lookup).toEqual({ Alta: 'alta', 'Alta District': 'alta' });
    expect(lookup.Old).toBeUndefined();
  });

  it('prefers the active district when an active and inactive share a label', () => {
    const districts = [
      district({ districtId: 'a-old', name: 'Acme', status: 'inactive' }),
      district({ districtId: 'a-new', name: 'Acme', status: 'active' }),
    ];
    expect(buildDistrictNameRegistryLookup(districts).Acme).toBe('a-new');
  });
});

describe('confirmUnknownScrapedDistrict', () => {
  it('creates a deterministic, active, provisional record with the exact name + source label', () => {
    const before = freeze([district({ districtId: 'alta', name: 'Alta' })]);
    const r1 = confirmUnknownScrapedDistrict(before, 'Granger');
    const r2 = confirmUnknownScrapedDistrict(before, 'Granger');
    expect(r1.outcome).toBe('added');
    expect(r1.changed).toBe(true);
    expect(r1.district).toEqual(r2.district); // deterministic
    expect(r1.district.districtId).toBe('granger');
    expect(r1.district.name).toBe('Granger');
    expect(r1.district.status).toBe('active');
    expect(r1.district.brandingProvisional).toBe(true);
    expect(r1.district.sourceLabels).toEqual(['Granger']);
    // input not mutated
    expect(before).toHaveLength(1);
    expect(r1.districts).toHaveLength(2);
  });

  it('is idempotent for an exact ACTIVE match (reuses, changes nothing)', () => {
    const before = [district({ districtId: 'alta', name: 'Alta', status: 'active' })];
    const r = confirmUnknownScrapedDistrict(before, 'Alta');
    expect(r.outcome).toBe('reused');
    expect(r.changed).toBe(false);
    expect(r.districts).toHaveLength(1);
    expect(r.district.districtId).toBe('alta');
  });

  it('reactivates an inactive-only exact match instead of a dead no-op (never deletes/duplicates)', () => {
    const before = freeze([district({ districtId: 'alta', name: 'Alta', status: 'inactive' })]);
    const r = confirmUnknownScrapedDistrict(before, 'Alta');
    expect(r.outcome).toBe('reactivated');
    expect(r.changed).toBe(true);
    expect(r.districts).toHaveLength(1); // reactivated in place — no duplicate appended
    expect(r.district.districtId).toBe('alta'); // same record, not a new id
    expect(r.district.status).toBe('active');
    // After reactivation the lookup resolves the scraped label at high confidence.
    expect(buildDistrictNameRegistryLookup(r.districts).Alta).toBe('alta');
    // input not mutated
    expect(before[0].status).toBe('inactive');
  });

  it('reactivates via an exact inactive SOURCE LABEL match (not just name)', () => {
    const before = [
      district({ districtId: 'alta', name: 'Alta', status: 'inactive', sourceLabels: ['Alta District'] }),
    ];
    const r = confirmUnknownScrapedDistrict(before, 'Alta District');
    expect(r.outcome).toBe('reactivated');
    expect(r.district.districtId).toBe('alta');
    expect(buildDistrictNameRegistryLookup(r.districts)['Alta District']).toBe('alta');
  });

  it('prefers reusing an ACTIVE match over reactivating an inactive same-name record', () => {
    const before = [
      district({ districtId: 'a-old', name: 'Acme', status: 'inactive' }),
      district({ districtId: 'a-new', name: 'Acme', status: 'active' }),
    ];
    const r = confirmUnknownScrapedDistrict(before, 'Acme');
    expect(r.outcome).toBe('reused');
    expect(r.changed).toBe(false);
    expect(r.district.districtId).toBe('a-new');
  });

  it('disambiguates a colliding id without overwriting a different district', () => {
    const before = [district({ districtId: 'bingham', name: 'Bingham' })];
    const r = confirmUnknownScrapedDistrict(before, 'Bingham!'); // slug collides with "bingham"
    expect(r.outcome).toBe('added');
    expect(r.district.districtId).toBe('bingham-2');
    expect(r.district.name).toBe('Bingham!');
  });
});

describe('inactivateDistrict (never deletes)', () => {
  it('marks a district inactive while preserving the record', () => {
    const before = freeze([district({ districtId: 'alta', name: 'Alta', status: 'active' })]);
    const r = inactivateDistrict(before, 'alta');
    expect(r.changed).toBe(true);
    if (r.changed) {
      expect(r.districts).toHaveLength(1); // not removed
      expect(findDistrictById(r.districts, 'alta')?.status).toBe('inactive');
    }
    expect(before[0].status).toBe('active'); // input not mutated
  });

  it('reports no change for an unknown or already-inactive district', () => {
    const districts = [district({ districtId: 'old', name: 'Old', status: 'inactive' })];
    expect(inactivateDistrict(districts, 'missing').changed).toBe(false);
    expect(inactivateDistrict(districts, 'old').changed).toBe(false);
  });

  it('has no hard-delete export', async () => {
    const mod = await import('../engine/districtRegistry');
    const deleteLike = Object.keys(mod).filter((k) => /delete|remove|destroy/i.test(k));
    expect(deleteLike).toEqual([]);
  });
});
