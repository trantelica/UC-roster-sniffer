import { describe, it, expect } from 'vitest';
import {
  mapUteScrapedAgeDivisionLabel,
  mapUteScrapedTeamClassification,
  mapUteScrapedDistrict,
  mapUteScrapedSeason,
  mapUteScrapedTeamTargetToCanonicalContext,
  createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext,
} from '../engine/uteConferenceScrapedCanonicalMapping';

function codes(issues: { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function playerPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'GridIron League 12',
      age_division_alias: 'GI',
      year: 2025,
      record_type: 'players',
      total_districts: 1,
      total_teams: 1,
      total_players: 2,
      source_url: 'https://ute.example/players',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GI League 12',
        teams_count: 1,
        teams: [
          {
            team_name: 'GridIron A3',
            source_url: 'https://ute.example/alta/a3',
            players_count: 2,
            players: [{ name: 'Cary, Hudson' }, { name: 'Sam Lee' }],
          },
        ],
      },
    ],
  };
}

function emptyLeaguePayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'GR League 9',
      year: 2025,
      record_type: 'players',
      total_teams: 0,
      total_players: 0,
      source_url: 'https://ute.example/players',
    },
    districts: [{ district: 'Alta', league: 'GR League 9', teams_count: 0, teams: [] }],
  };
}

// ---------------------------------------------------------------------------
// 1-8. age division mapping
// ---------------------------------------------------------------------------

describe('age division mapping', () => {
  it('1. maps "SC League 7-8" to SC', () => {
    expect(mapUteScrapedAgeDivisionLabel({ label: 'SC League 7-8' }).canonicalValue).toBe(
      'SC'
    );
  });

  it('2. maps "Scouts" to SC', () => {
    expect(mapUteScrapedAgeDivisionLabel({ label: 'Scouts' }).canonicalValue).toBe('SC');
  });

  it('3. maps "Scout" team prefix to SC when metadata label missing', () => {
    const r = mapUteScrapedAgeDivisionLabel({ teamName: 'Scout White' });
    expect(r.canonicalValue).toBe('SC');
    expect(r.source).toBe('team-name');
    expect(r.confidence).toBe('provisional');
  });

  it('4. maps "GR League 9" to GR', () => {
    expect(mapUteScrapedAgeDivisionLabel({ label: 'GR League 9' }).canonicalValue).toBe(
      'GR'
    );
  });

  it('5. maps "Gremlin" team prefix to GR when metadata label missing', () => {
    expect(
      mapUteScrapedAgeDivisionLabel({ teamName: 'Gremlin A2' }).canonicalValue
    ).toBe('GR');
  });

  it('6. maps "PW League 10" to PW', () => {
    expect(mapUteScrapedAgeDivisionLabel({ label: 'PW League 10' }).canonicalValue).toBe(
      'PW'
    );
  });

  it('7. maps "PeeWees" to PW', () => {
    expect(mapUteScrapedAgeDivisionLabel({ label: 'PeeWees' }).canonicalValue).toBe('PW');
  });

  it('8. maps "PeeWee" team prefix to PW when metadata label missing', () => {
    expect(
      mapUteScrapedAgeDivisionLabel({ teamName: 'PeeWee C1' }).canonicalValue
    ).toBe('PW');
  });

  it('9. unsupported age division returns unknown with an issue', () => {
    const r = mapUteScrapedAgeDivisionLabel({ label: 'Flag Football League 5' });
    expect(r.canonicalValue).toBeNull();
    expect(r.confidence).toBe('unknown');
    expect(codes(r.issues)).toContain('unsupported-age-division');
  });

  it('10. conflicting metadata label and alias returns an issue', () => {
    const r = mapUteScrapedAgeDivisionLabel({ label: 'GR League 9', alias: 'PW' });
    expect(codes(r.issues)).toContain('conflicting-age-division-labels');
  });

  it('also maps known MM/GI/BA labels deterministically', () => {
    expect(mapUteScrapedAgeDivisionLabel({ label: 'Mity Mite' }).canonicalValue).toBe(
      'MM'
    );
    expect(mapUteScrapedAgeDivisionLabel({ label: 'GridIron' }).canonicalValue).toBe('GI');
    expect(mapUteScrapedAgeDivisionLabel({ label: 'Bantam' }).canonicalValue).toBe('BA');
  });
});

// ---------------------------------------------------------------------------
// 11-12. season mapping
// ---------------------------------------------------------------------------

describe('season mapping', () => {
  it('11. maps a valid metadata.year into season context', () => {
    const r = mapUteScrapedSeason({ year: 2025, event: 'Fall' });
    expect(r.canonicalValue).toBe('2025');
    expect(r.seasonLabel).toBe('Fall');
    expect(r.confidence).toBe('high');
    expect(r.source).toBe('metadata-year');
  });

  it('12. missing/invalid year returns an issue', () => {
    expect(codes(mapUteScrapedSeason({}).issues)).toContain('missing-season-year');
    expect(codes(mapUteScrapedSeason({ year: 'soon' }).issues)).toContain(
      'invalid-season-year'
    );
    expect(mapUteScrapedSeason({ year: 'soon' }).canonicalValue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 13-15. district mapping
// ---------------------------------------------------------------------------

describe('district mapping', () => {
  it('13. preserves the raw district name', () => {
    const r = mapUteScrapedDistrict({ districtName: 'Bingham Girls' });
    expect(r.rawValue).toBe('Bingham Girls');
  });

  it('14. derives a provisional district slug when no registry exists', () => {
    const r = mapUteScrapedDistrict({ districtName: 'Alta' });
    expect(r.canonicalValue).toBe('alta');
    expect(r.confidence).toBe('provisional');
    expect(codes(r.issues)).toContain('district-mapping-provisional');
  });

  it('15. does not collapse "Bingham" and "Bingham Girls"', () => {
    const a = mapUteScrapedDistrict({ districtName: 'Bingham' });
    const b = mapUteScrapedDistrict({ districtName: 'Bingham Girls' });
    expect(a.canonicalValue).toBe('bingham');
    expect(b.canonicalValue).toBe('bingham-girls');
    expect(a.canonicalValue).not.toBe(b.canonicalValue);
  });

  it('uses a registry id at high confidence when provided', () => {
    const r = mapUteScrapedDistrict({
      districtName: 'Alta',
      districtRegistry: { Alta: 'alta' },
    });
    expect(r.confidence).toBe('high');
    expect(r.canonicalValue).toBe('alta');
  });
});

// ---------------------------------------------------------------------------
// 16-22. team classification extraction
// ---------------------------------------------------------------------------

describe('team classification extraction', () => {
  it('16. extracts A2 from "Gremlin A2"', () => {
    const r = mapUteScrapedTeamClassification({ teamName: 'Gremlin A2' });
    expect(r.canonicalValue).toBe('A2');
    expect(r.hierarchyCode).toBe('A');
    expect(r.confidence).toBe('high');
  });

  it('17. extracts D2 from "Gremlin D2"', () => {
    expect(
      mapUteScrapedTeamClassification({ teamName: 'Gremlin D2' }).canonicalValue
    ).toBe('D2');
  });

  it('18. extracts C1 from "PeeWee C1"', () => {
    expect(
      mapUteScrapedTeamClassification({ teamName: 'PeeWee C1' }).canonicalValue
    ).toBe('C1');
  });

  it('19. extracts B4 from "PeeWee B4"', () => {
    const r = mapUteScrapedTeamClassification({ teamName: 'PeeWee B4' });
    expect(r.canonicalValue).toBe('B4');
    expect(r.hierarchyCode).toBe('B3_PLUS');
  });

  it('20. leaves "Scout White" classification unknown/review-needed', () => {
    const r = mapUteScrapedTeamClassification({ teamName: 'Scout White' });
    expect(r.canonicalValue).toBeNull();
    expect(r.confidence).toBe('unknown');
    expect(codes(r.issues)).toContain('color-team-classification-unknown');
  });

  it('21. leaves "Scout Black" classification unknown/review-needed', () => {
    const r = mapUteScrapedTeamClassification({ teamName: 'Scout Black' });
    expect(r.canonicalValue).toBeNull();
    expect(codes(r.issues)).toContain('color-team-classification-unknown');
  });

  it('22. does not invent a color-to-classification mapping', () => {
    for (const color of ['Scout White', 'Scout Black', 'Scout Gray', 'Scout Silver']) {
      const r = mapUteScrapedTeamClassification({ teamName: color });
      expect(r.canonicalValue).toBeNull();
      expect(r.hierarchyCode).toBeNull();
    }
  });

  it('rejects an out-of-range code as unsupported, not invented', () => {
    const r = mapUteScrapedTeamClassification({ teamName: 'Gremlin C3' });
    expect(r.canonicalValue).toBeNull();
    expect(codes(r.issues)).toContain('unsupported-team-classification');
  });
});

// ---------------------------------------------------------------------------
// 23. caller override
// ---------------------------------------------------------------------------

describe('caller override', () => {
  it('23. override replaces derived canonical context but preserves raw source values', () => {
    const payload = playerPayload();
    const r = mapUteScrapedTeamTargetToCanonicalContext(
      payload,
      { districtIndex: 0, teamIndex: 0 },
      {
        override: {
          seasonId: '2099',
          districtId: 'alta-canonical',
          ageDivisionId: 'GI',
          teamId: '2099-alta-canonical-GI-A3',
          teamClassification: 'A3',
        },
      }
    );
    expect(r.canonicalContext).toEqual({
      seasonId: '2099',
      districtId: 'alta-canonical',
      ageDivisionId: 'GI',
      teamId: '2099-alta-canonical-GI-A3',
      teamClassification: 'A3',
    });
    // Raw source preserved on each mapping result.
    expect(r.district.rawValue).toBe('Alta');
    expect(r.season.rawValue).toBe('2025');
    expect(r.season.source).toBe('caller-override');
    expect(r.district.source).toBe('caller-override');
    expect(codes(r.issues)).toContain('caller-override-used');
    // Payload untouched.
    expect(payload.districts[0].district).toBe('Alta');
  });
});

// ---------------------------------------------------------------------------
// 24-25. player preview integration
// ---------------------------------------------------------------------------

describe('player preview integration', () => {
  it('24. returns canonicalContextMapping + previewInput + previewResult', () => {
    const payload = playerPayload();
    const r = createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(
      payload,
      { districtIndex: 0, teamIndex: 0 }
    );
    expect(r.canonicalContextMapping).toBeDefined();
    expect(r.previewInput.rows).toHaveLength(2);
    expect(r.previewResult).not.toBeNull();
    expect(r.previewResult?.rows).toHaveLength(2);
    // Canonical context flowed into the preview target.
    expect(r.canonicalContextMapping.canonicalContext.ageDivisionId).toBe('GI');
    expect(r.previewResult?.target.ageDivisionId).toBe('GI');
    expect(r.previewResult?.target.seasonId).toBe('2025');
    // teamId derived from extracted classification A3.
    expect(r.canonicalContextMapping.canonicalContext.teamId).toBe('2025-alta-gi-a3');
  });

  it('25. preserves comma names exactly', () => {
    const payload = playerPayload();
    const r = createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(
      payload,
      { districtIndex: 0, teamIndex: 0 }
    );
    expect(r.previewInput.rows[0].playerName).toBe('Cary, Hudson');
    expect(r.previewResult?.rows[0].playerName).toBe('Cary, Hudson');
  });
});

// ---------------------------------------------------------------------------
// 26-28. snapshots & target resolution
// ---------------------------------------------------------------------------

describe('snapshots and target resolution', () => {
  it('26. maps an empty league snapshot safely without throwing', () => {
    const payload = emptyLeaguePayload();
    expect(() =>
      mapUteScrapedTeamTargetToCanonicalContext(payload, { districtIndex: 0, teamIndex: 0 })
    ).not.toThrow();
    const r = mapUteScrapedTeamTargetToCanonicalContext(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    // No teams in the snapshot -> the target cannot be resolved.
    expect(r.ok).toBe(false);
    expect(codes(r.issues)).toContain('target-not-found');
  });

  it('27. reports target-not-found for an unknown selector', () => {
    const r = mapUteScrapedTeamTargetToCanonicalContext(
      playerPayload(),
      'scraped:2025:nope:9:9'
    );
    expect(r.ok).toBe(false);
    expect(codes(r.issues)).toContain('target-not-found');
  });

  it('28. reports invalid-target for an empty selector', () => {
    const r = mapUteScrapedTeamTargetToCanonicalContext(playerPayload(), {});
    expect(r.ok).toBe(false);
    expect(codes(r.issues)).toContain('invalid-target');
  });
});

// ---------------------------------------------------------------------------
// 29-30. purity
// ---------------------------------------------------------------------------

describe('purity', () => {
  it('29. does not mutate the input payload', () => {
    const payload = playerPayload();
    const before = JSON.parse(JSON.stringify(payload));
    mapUteScrapedTeamTargetToCanonicalContext(payload, { districtIndex: 0, teamIndex: 0 });
    createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(JSON.parse(JSON.stringify(payload))).toEqual(before);
  });

  it('30. produces deterministic output across repeated calls', () => {
    const a = mapUteScrapedTeamTargetToCanonicalContext(playerPayload(), {
      districtIndex: 0,
      teamIndex: 0,
    });
    const b = mapUteScrapedTeamTargetToCanonicalContext(playerPayload(), {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(a).toEqual(b);

    const c = createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(
      playerPayload(),
      { districtIndex: 0, teamIndex: 0 }
    );
    const d = createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(
      playerPayload(),
      { districtIndex: 0, teamIndex: 0 }
    );
    expect(c).toEqual(d);
  });
});
