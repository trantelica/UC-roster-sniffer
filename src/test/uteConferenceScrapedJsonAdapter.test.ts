import { describe, it, expect } from 'vitest';
import * as adapter from '../engine/uteConferenceScrapedJsonAdapter';
import {
  detectUteConferenceScrapedJsonRecordType,
  summarizeUteConferenceScrapedJson,
  listUteConferenceScrapedJsonTeamTargets,
  createPlayerRosterImportPreviewInputFromScrapedJson,
  createCoachImportPreviewInputFromScrapedJson,
} from '../engine/uteConferenceScrapedJsonAdapter';

// ---------------------------------------------------------------------------
// Fixtures (representative harvested shapes)
// ---------------------------------------------------------------------------

const NBSP = ' ';

function playerPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'GridIron League 12',
      age_division_alias: 'GI',
      year: 2025,
      record_type: 'players',
      total_districts: 2,
      districts_with_league: 2,
      districts_without_league: 0,
      total_teams: 3,
      total_players: 5,
      scraped_at: '2025-09-01T00:00:00Z',
      source_url: 'https://ute.example/players',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GI League 12',
        teams_count: 2,
        teams: [
          {
            team_name: 'GridIron A3',
            source_url: 'https://ute.example/alta/a3',
            players_count: 3,
            players: [
              { name: 'Cary, Hudson' },
              { name: '  John   Doe  ' },
              { name: '' },
            ],
          },
          {
            team_name: 'GridIron C1',
            source_url: 'https://ute.example/alta/c1',
            players_count: 1,
            players: [{ name: 'Sam Lee' }],
          },
        ],
      },
      {
        district: 'Brighton',
        league: 'GI League 12',
        teams_count: 1,
        teams: [
          {
            team_name: 'GridIron B2',
            source_url: 'https://ute.example/brighton/b2',
            players_count: 1,
            players: [{ name: 'Pat Kim' }],
          },
        ],
      },
    ],
  };
}

function coachPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'GridIron League 12',
      age_division_alias: 'GI',
      year: 2025,
      record_type: 'coaches',
      total_districts: 1,
      districts_with_league: 1,
      districts_without_league: 0,
      total_teams: 1,
      total_coaches: 4,
      scraped_at: '2025-09-01T00:00:00Z',
      source_url: 'https://ute.example/coaches',
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
            coaches_count: 4,
            coaches: [
              { name: `Head${NBSP}Coach Jane`, title: 'Head Coach' },
              { name: 'Asst Bob', title: 'Assistant' },
              { name: 'Asst Bob', title: 'Assistant' },
              { name: '', title: '' },
            ],
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
      age_division: 'GridIron League 12',
      age_division_alias: 'GI',
      year: 2025,
      record_type: 'players',
      total_districts: 1,
      districts_with_league: 1,
      districts_without_league: 0,
      total_teams: 0,
      total_players: 0,
      source_url: 'https://ute.example/players',
    },
    districts: [{ district: 'Alta', league: 'GI League 12', teams_count: 0, teams: [] }],
  };
}

function mismatchPayload() {
  return {
    metadata: {
      record_type: 'players',
      year: 2025,
      age_division: 'GI',
      total_teams: 1,
      total_players: 5,
      source_url: 'https://ute.example/players',
    },
    districts: [
      {
        district: 'Alta',
        league: 'L',
        teams_count: 1,
        teams: [
          {
            team_name: 'T',
            players_count: 5,
            players: [{ name: 'A' }, { name: 'B' }],
          },
        ],
      },
    ],
  };
}

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    Object.values(obj as Record<string, unknown>).forEach(deepFreeze);
    Object.freeze(obj);
  }
  return obj;
}

// ---------------------------------------------------------------------------
// 1-3. detection
// ---------------------------------------------------------------------------

describe('record type detection', () => {
  it('1. detects players record type', () => {
    expect(detectUteConferenceScrapedJsonRecordType(playerPayload())).toBe(
      'players'
    );
  });

  it('2. detects coaches record type', () => {
    expect(detectUteConferenceScrapedJsonRecordType(coachPayload())).toBe(
      'coaches'
    );
  });

  it('3. unsupported/missing record type reports unknown and an issue', () => {
    expect(
      detectUteConferenceScrapedJsonRecordType({
        metadata: { record_type: 'rosters' },
        districts: [],
      })
    ).toBe('unknown');
    expect(detectUteConferenceScrapedJsonRecordType({})).toBe('unknown');
    expect(detectUteConferenceScrapedJsonRecordType(null)).toBe('unknown');

    const summary = summarizeUteConferenceScrapedJson({
      metadata: { record_type: 'rosters' },
      districts: [],
    });
    expect(summary.recordType).toBe('unknown');
    expect(summary.issues.map((i) => i.code)).toContain('unsupported-record-type');
    expect(summary.ok).toBe(false);

    const noMeta = summarizeUteConferenceScrapedJson({});
    expect(noMeta.issues.map((i) => i.code)).toContain('missing-metadata');
  });
});

// ---------------------------------------------------------------------------
// 4-6. summaries
// ---------------------------------------------------------------------------

describe('summaries', () => {
  it('4. summarizes player file metadata', () => {
    const s = summarizeUteConferenceScrapedJson(playerPayload());
    expect(s.recordType).toBe('players');
    expect(s.organization).toBe('Ute Conference');
    expect(s.event).toBe('Fall');
    expect(s.year).toBe('2025');
    expect(s.ageDivision).toBe('GridIron League 12');
    expect(s.ageDivisionAlias).toBe('GI');
    expect(s.totalDistricts).toBe(2);
    expect(s.totalTeams).toBe(3);
    expect(s.totalRows).toBe(5);
    expect(s.teamsWithRows).toBe(3);
    expect(s.emptyTeams).toBe(0);
    expect(s.ok).toBe(true);
  });

  it('5. summarizes coach file metadata', () => {
    const s = summarizeUteConferenceScrapedJson(coachPayload());
    expect(s.recordType).toBe('coaches');
    expect(s.totalTeams).toBe(1);
    expect(s.totalRows).toBe(4);
    expect(s.ok).toBe(true);
  });

  it('6. accepts a valid empty league snapshot', () => {
    const s = summarizeUteConferenceScrapedJson(emptyLeaguePayload());
    expect(s.ok).toBe(true);
    expect(s.totalRows).toBe(0);
    expect(s.totalTeams).toBe(0);
    expect(s.issues.map((i) => i.code)).toContain('empty-league');
    expect(s.issues.every((i) => i.severity !== 'error')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 7-11. team targets
// ---------------------------------------------------------------------------

describe('team targets', () => {
  it('7. lists team targets for a player file', () => {
    const targets = listUteConferenceScrapedJsonTeamTargets(playerPayload());
    expect(targets).toHaveLength(3);
    expect(targets.every((t) => t.recordType === 'players')).toBe(true);
  });

  it('8. lists team targets for a coach file', () => {
    const targets = listUteConferenceScrapedJsonTeamTargets(coachPayload());
    expect(targets).toHaveLength(1);
    expect(targets[0].recordType).toBe('coaches');
  });

  it('9. preserves target order by district/team source order', () => {
    const targets = listUteConferenceScrapedJsonTeamTargets(playerPayload());
    expect(targets.map((t) => t.teamName)).toEqual([
      'GridIron A3',
      'GridIron C1',
      'GridIron B2',
    ]);
    expect(targets.map((t) => [t.districtIndex, t.teamIndex])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  it('10. player target includes year, age division, district, team, source URL, row count', () => {
    const t = listUteConferenceScrapedJsonTeamTargets(playerPayload())[0];
    expect(t.year).toBe('2025');
    expect(t.ageDivisionLabel).toBe('GridIron League 12');
    expect(t.ageDivisionAlias).toBe('GI');
    expect(t.districtName).toBe('Alta');
    expect(t.teamName).toBe('GridIron A3');
    expect(t.teamSourceUrl).toBe('https://ute.example/alta/a3');
    expect(t.sourceUrl).toBe('https://ute.example/players');
    expect(t.rowCount).toBe(3);
    expect(t.playersCount).toBe(3);
    expect(t.coachesCount).toBeNull();
    expect(t.sourceTargetId).toBe('scraped:2025:gridiron-league-12:0:0');
  });

  it('11. coach target includes year, age division, district, team, source URL, row count', () => {
    const t = listUteConferenceScrapedJsonTeamTargets(coachPayload())[0];
    expect(t.year).toBe('2025');
    expect(t.districtName).toBe('Alta');
    expect(t.teamName).toBe('GridIron A3');
    expect(t.teamSourceUrl).toBe('https://ute.example/alta/a3');
    expect(t.rowCount).toBe(4);
    expect(t.coachesCount).toBe(4);
    expect(t.playersCount).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 12-15. player adapter
// ---------------------------------------------------------------------------

describe('player adapter', () => {
  it('12. creates a RosterImportPreviewInput for the selected team', () => {
    const payload = playerPayload();
    const target = listUteConferenceScrapedJsonTeamTargets(payload)[0];
    const result = createPlayerRosterImportPreviewInputFromScrapedJson(
      payload,
      target.sourceTargetId
    );
    expect(result.recordType).toBe('players');
    expect(result.previewInput.rows).toHaveLength(3);
    expect(result.targetContext).toEqual({
      seasonId: '2025',
      districtId: 'alta',
      ageDivisionId: 'gi',
      teamId: '2025-alta-gi-gridiron-a3',
    });
    expect(result.targetContextProvisional).toBe(true);
    expect(result.previewInput.rows[0].sourceRowId).toBe(
      'scraped:2025:gridiron-league-12:0:0:player:0'
    );
    // Composition: the slice 1 preview ran over the generated input.
    expect(result.previewResult?.rows).toHaveLength(3);
  });

  it('13. preserves player names with commas exactly', () => {
    const payload = playerPayload();
    const result = createPlayerRosterImportPreviewInputFromScrapedJson(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(result.previewInput.rows[0].playerName).toBe('Cary, Hudson');
    expect(result.previewResult?.rows[0].playerName).toBe('Cary, Hudson');
  });

  it('14. preserves player names with extra spaces exactly', () => {
    const payload = playerPayload();
    const result = createPlayerRosterImportPreviewInputFromScrapedJson(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(result.previewInput.rows[1].playerName).toBe('  John   Doe  ');
  });

  it('15. preserves a missing player name row and adds an issue', () => {
    const payload = playerPayload();
    const result = createPlayerRosterImportPreviewInputFromScrapedJson(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(result.previewInput.rows).toHaveLength(3);
    expect(result.previewInput.rows[2].playerName).toBeUndefined();
    expect(result.previewInput.rows[2].sourceRowId).toBe(
      'scraped:2025:gridiron-league-12:0:0:player:2'
    );
    expect(result.issues.map((i) => i.code)).toContain('missing-player-name');
    // The preview marks it invalid (distinct from the adapter issue).
    expect(result.previewResult?.rows[2].status).toBe('invalid');
  });
});

// ---------------------------------------------------------------------------
// 16-21. coach adapter
// ---------------------------------------------------------------------------

describe('coach adapter', () => {
  it('16. creates coach preview rows for the selected team', () => {
    const payload = coachPayload();
    const target = listUteConferenceScrapedJsonTeamTargets(payload)[0];
    const result = createCoachImportPreviewInputFromScrapedJson(
      payload,
      target.sourceTargetId
    );
    expect(result.recordType).toBe('coaches');
    expect(result.rows).toHaveLength(4);
    expect(result.rows[0].sourceRowId).toBe(
      'scraped:2025:gridiron-league-12:0:0:coach:0'
    );
    expect(result.summary.totalRows).toBe(4);
  });

  it('17. preserves coach names exactly, including non-breaking spaces', () => {
    const payload = coachPayload();
    const result = createCoachImportPreviewInputFromScrapedJson(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(result.rows[0].rawName).toBe(`Head${NBSP}Coach Jane`);
    expect(result.rows[0].rawName?.includes(NBSP)).toBe(true);
  });

  it('18. preserves coach titles exactly', () => {
    const payload = coachPayload();
    const result = createCoachImportPreviewInputFromScrapedJson(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(result.rows[0].rawTitle).toBe('Head Coach');
    expect(result.rows[1].rawTitle).toBe('Assistant');
  });

  it('19. preserves a missing coach name row and adds an issue', () => {
    const payload = coachPayload();
    const result = createCoachImportPreviewInputFromScrapedJson(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(result.rows).toHaveLength(4);
    expect(result.rows[3].issues.map((i) => i.code)).toContain(
      'missing-coach-name'
    );
    expect(result.summary.missingName).toBe(1);
  });

  it('20. preserves a missing coach title row and adds an issue', () => {
    const payload = coachPayload();
    const result = createCoachImportPreviewInputFromScrapedJson(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(result.rows[3].issues.map((i) => i.code)).toContain(
      'missing-coach-title'
    );
    expect(result.summary.missingTitle).toBe(1);
  });

  it('21. preserves duplicate coach name/title rows (no de-duplication)', () => {
    const payload = coachPayload();
    const result = createCoachImportPreviewInputFromScrapedJson(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(result.rows[1].rawName).toBe('Asst Bob');
    expect(result.rows[2].rawName).toBe('Asst Bob');
    expect(result.rows[1].rawTitle).toBe('Assistant');
    expect(result.rows[2].rawTitle).toBe('Assistant');
    // Both preserved as distinct rows with distinct source ids.
    expect(result.rows[1].sourceRowId).not.toBe(result.rows[2].sourceRowId);
  });
});

// ---------------------------------------------------------------------------
// 22-23. target resolution & counts
// ---------------------------------------------------------------------------

describe('target resolution and counts', () => {
  it('22. reports target-not-found for an unknown selector', () => {
    const result = createPlayerRosterImportPreviewInputFromScrapedJson(
      playerPayload(),
      'scraped:2025:nope:9:9'
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('target-not-found');
    expect(result.previewInput.rows).toEqual([]);
  });

  it('reports invalid-target for an empty selector', () => {
    const result = createPlayerRosterImportPreviewInputFromScrapedJson(
      playerPayload(),
      {}
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain('invalid-target');
  });

  it('23. reports a count mismatch but preserves rows', () => {
    const summary = summarizeUteConferenceScrapedJson(mismatchPayload());
    expect(summary.issues.map((i) => i.code)).toContain('count-mismatch');

    const result = createPlayerRosterImportPreviewInputFromScrapedJson(
      mismatchPayload(),
      { districtIndex: 0, teamIndex: 0 }
    );
    expect(result.issues.map((i) => i.code)).toContain('count-mismatch');
    expect(result.previewInput.rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 24-27. purity & boundaries
// ---------------------------------------------------------------------------

describe('purity and boundaries', () => {
  it('24. does not mutate the input payload', () => {
    const payload = playerPayload();
    const before = JSON.parse(JSON.stringify(payload));
    summarizeUteConferenceScrapedJson(payload);
    listUteConferenceScrapedJsonTeamTargets(payload);
    createPlayerRosterImportPreviewInputFromScrapedJson(payload, {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(JSON.parse(JSON.stringify(payload))).toEqual(before);
  });

  it('25. produces deterministic output across repeated calls', () => {
    const a = createPlayerRosterImportPreviewInputFromScrapedJson(playerPayload(), {
      districtIndex: 0,
      teamIndex: 0,
    });
    const b = createPlayerRosterImportPreviewInputFromScrapedJson(playerPayload(), {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(a).toEqual(b);

    const c = createCoachImportPreviewInputFromScrapedJson(coachPayload(), {
      districtIndex: 0,
      teamIndex: 0,
    });
    const d = createCoachImportPreviewInputFromScrapedJson(coachPayload(), {
      districtIndex: 0,
      teamIndex: 0,
    });
    expect(c).toEqual(d);
  });

  it('26. operates on a deeply frozen payload without mutation', () => {
    const payload = deepFreeze(playerPayload());
    expect(() => {
      summarizeUteConferenceScrapedJson(payload);
      listUteConferenceScrapedJsonTeamTargets(payload);
      createPlayerRosterImportPreviewInputFromScrapedJson(payload, {
        districtIndex: 0,
        teamIndex: 0,
      });
    }).not.toThrow();
  });

  it('27. exposes no import apply/write/persist function', () => {
    const exported = Object.keys(adapter);
    expect(
      exported.some((name) => /apply|commit|write|persist|save|delete/i.test(name))
    ).toBe(false);
  });
});
