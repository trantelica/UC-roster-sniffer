import { describe, it, expect } from 'vitest';
import type { District } from '../domain/types';
import {
  mapUteScrapedTeamTargetToCanonicalContext,
} from '../engine/uteConferenceScrapedCanonicalMapping';
import { createUteConferenceScrapedJsonReadinessReport } from '../engine/uteConferenceScrapedJsonReadinessReport';
import {
  buildDistrictNameRegistryLookup,
  confirmUnknownScrapedDistrict,
} from '../engine/districtRegistry';

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

function payload(districtName: string) {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'GR League 9',
      age_division_alias: 'GR',
      year: 2026,
      record_type: 'players',
      source_url: 'https://ute.example/players',
    },
    districts: [
      {
        district: districtName,
        league: 'GR League 9',
        teams_count: 1,
        teams: [
          {
            team_name: 'Gremlin B1',
            source_url: 'https://ute.example/x/b1',
            players_count: 1,
            players: [{ name: 'Jordan Smith' }],
          },
        ],
      },
    ],
  };
}

const target = { districtIndex: 0, teamIndex: 0 };

describe('registry-backed scraped district mapping', () => {
  it('resolves a registered known district at high confidence (no provisional warning)', () => {
    const registry = [district({ districtId: 'alta', name: 'Alta', status: 'active' })];
    const lookup = buildDistrictNameRegistryLookup(registry);
    const r = mapUteScrapedTeamTargetToCanonicalContext(payload('Alta'), target, {
      districtRegistry: lookup,
    });
    expect(r.district.confidence).toBe('high');
    expect(r.district.canonicalValue).toBe('alta');
    expect(r.district.issues.map((i) => i.code)).not.toContain('district-mapping-provisional');
  });

  it('keeps an unregistered district provisional until confirmed', () => {
    const registry = [district({ districtId: 'alta', name: 'Alta', status: 'active' })];
    const lookup = buildDistrictNameRegistryLookup(registry);
    const r = mapUteScrapedTeamTargetToCanonicalContext(payload('Granger'), target, {
      districtRegistry: lookup,
    });
    expect(r.district.confidence).toBe('provisional');
    expect(r.district.rawValue).toBe('Granger'); // raw name preserved exactly
    expect(r.district.issues.map((i) => i.code)).toContain('district-mapping-provisional');
  });

  it('resolves cleanly on re-derive after the unknown district is confirmed', () => {
    let registry = [district({ districtId: 'alta', name: 'Alta', status: 'active' })];
    // Provisional first.
    const before = mapUteScrapedTeamTargetToCanonicalContext(payload('Granger'), target, {
      districtRegistry: buildDistrictNameRegistryLookup(registry),
    });
    expect(before.district.confidence).toBe('provisional');

    // Confirm it into the registry, then re-derive against the updated registry.
    const confirmed = confirmUnknownScrapedDistrict(registry, 'Granger');
    registry = confirmed.districts;
    const after = mapUteScrapedTeamTargetToCanonicalContext(payload('Granger'), target, {
      districtRegistry: buildDistrictNameRegistryLookup(registry),
    });
    expect(after.district.confidence).toBe('high');
    expect(after.district.canonicalValue).toBe('granger');
  });

  it('prefers an active registered district over an inactive same-name district', () => {
    const registry = [
      district({ districtId: 'a-old', name: 'Acme', status: 'inactive' }),
      district({ districtId: 'a-new', name: 'Acme', status: 'active' }),
    ];
    const r = mapUteScrapedTeamTargetToCanonicalContext(payload('Acme'), target, {
      districtRegistry: buildDistrictNameRegistryLookup(registry),
    });
    expect(r.district.confidence).toBe('high');
    expect(r.district.canonicalValue).toBe('a-new');
  });

  it('does not fuzzy-match or collapse distinct district names', () => {
    const registry = [
      district({ districtId: 'bingham', name: 'Bingham', status: 'active' }),
    ];
    const lookup = buildDistrictNameRegistryLookup(registry);
    // "Bingham Girls" must NOT collapse onto "Bingham".
    const girls = mapUteScrapedTeamTargetToCanonicalContext(payload('Bingham Girls'), target, {
      districtRegistry: lookup,
    });
    expect(girls.district.confidence).toBe('provisional');
    expect(girls.district.canonicalValue).toBe('bingham-girls');
    // A near miss does not match either.
    const near = mapUteScrapedTeamTargetToCanonicalContext(payload('bingham'), target, {
      districtRegistry: lookup,
    });
    expect(near.district.confidence).toBe('provisional');
  });
});

describe('registry flows through the full readiness report', () => {
  it('a registered district stops emitting the provisional district issue end-to-end', () => {
    const registry = [district({ districtId: 'alta', name: 'Alta', status: 'active' })];
    const lookup = buildDistrictNameRegistryLookup(registry);
    const report = createUteConferenceScrapedJsonReadinessReport(payload('Alta'), {
      districtRegistry: lookup,
    });
    const t = report.targets[0];
    expect(t.issues.map((i) => i.code)).not.toContain('district-mapping-provisional');
  });

  it('an unregistered district still surfaces the provisional district issue', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(payload('Granger'), {
      districtRegistry: {},
    });
    const t = report.targets[0];
    expect(t.issues.map((i) => i.code)).toContain('district-mapping-provisional');
  });
});
