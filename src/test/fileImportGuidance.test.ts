import { describe, it, expect } from 'vitest';
import { classifyImportFileShape } from '../engine/importFileShape';
import {
  buildDatasetImportErrorGuidance,
  buildScrapedImportErrorGuidance,
} from '../app/fileImportGuidance';
import {
  buildWorkspaceSnapshot,
  parseWorkspaceSnapshotJson,
  type WorkspaceState,
} from '../engine/workspaceSnapshot';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function playersPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'GR League 9',
      year: 2026,
      record_type: 'players',
      source_url: 'https://ute.example/players',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GR League 9',
        teams_count: 1,
        teams: [
          { team_name: 'Gremlin B1', players_count: 1, players: [{ name: 'A B' }] },
        ],
      },
    ],
  };
}

function coachesPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'GR League 9',
      year: 2026,
      record_type: 'coaches',
      source_url: 'https://ute.example/coaches',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GR League 9',
        teams_count: 1,
        teams: [{ team_name: 'Gremlin B1', coaches_count: 1, coaches: [{ name: 'C', title: 'Head Coach' }] }],
      },
    ],
  };
}

function validSnapshotJson(): string {
  const workspace: WorkspaceState = {
    districts: [
      {
        districtId: 'alta',
        name: 'Alta',
        mascot: 'Hawks',
        logoAssetPath: '',
        helmetAssetPath: '',
        primaryColor: '#000',
        secondaryColor: '#fff',
        status: 'active',
      },
    ],
    ageDivisions: [],
    teams: [
      {
        teamId: 't1',
        seasonId: '2026',
        districtId: 'alta',
        ageDivisionId: 'GR',
        teamCode: 'B1',
        draftOrder: 1,
        divisionTeamCount: 1,
        headCoach: null,
        assistantCoaches: [],
        players: [{ name: 'P One' }],
      },
    ],
    games: [],
    coaches: [],
    coachAssignments: [],
    selection: { seasonId: null, districtId: null, ageDivisionId: null, teamId: null },
  };
  return JSON.stringify(
    buildWorkspaceSnapshot({ workspace, generatedAt: '2026-06-28T00:00:00.000Z' })
  );
}

// ---------------------------------------------------------------------------
// classifyImportFileShape
// ---------------------------------------------------------------------------

describe('classifyImportFileShape', () => {
  it('classifies a UC Roster Sniffer dataset snapshot', () => {
    const parsed = parseWorkspaceSnapshotJson(validSnapshotJson());
    expect(parsed.ok).toBe(true);
    expect(classifyImportFileShape(JSON.parse(validSnapshotJson()))).toBe('dataset-snapshot');
  });

  it('classifies scraped players and coaches files', () => {
    expect(classifyImportFileShape(playersPayload())).toBe('scraped-players');
    expect(classifyImportFileShape(coachesPayload())).toBe('scraped-coaches');
  });

  it('classifies a scraped-looking file with an unsupported record type', () => {
    const p = playersPayload();
    (p.metadata as { record_type: string }).record_type = 'banners';
    expect(classifyImportFileShape(p)).toBe('scraped-unknown');
  });

  it('classifies unrelated JSON as unknown', () => {
    expect(classifyImportFileShape({ hello: 'world' })).toBe('unknown');
    expect(classifyImportFileShape([1, 2, 3])).toBe('unknown');
    expect(classifyImportFileShape('nope')).toBe('unknown');
  });

  it('does not mutate the payload', () => {
    const p = playersPayload();
    const json = JSON.stringify(p);
    classifyImportFileShape(p);
    expect(JSON.stringify(p)).toBe(json);
  });
});

// ---------------------------------------------------------------------------
// Dataset Import guidance
// ---------------------------------------------------------------------------

describe('buildDatasetImportErrorGuidance', () => {
  it('classifies invalid JSON plainly', () => {
    const g = buildDatasetImportErrorGuidance('{ not json', [
      { code: 'invalid-json', message: 'Unexpected token' },
    ]);
    expect(g.what.toLowerCase()).toContain("isn't valid json");
    expect(g.detail).toContain('invalid-json');
  });

  it('detects a scraped players file dropped into Dataset Import and points to Roster import', () => {
    const text = JSON.stringify(playersPayload());
    const g = buildDatasetImportErrorGuidance(text, [
      { code: 'wrong-snapshot-kind', message: 'kind mismatch' },
    ]);
    expect(g.what).toContain('scraped Ute Conference');
    expect(g.tryThis).toContain('Roster import');
  });

  it('gives a version-specific message for an unsupported schema version', () => {
    const text = JSON.stringify({ snapshotKind: 'workspace', schemaVersion: 999, workspace: {} });
    const g = buildDatasetImportErrorGuidance(text, [
      { code: 'unsupported-schema-version', message: 'Unsupported schemaVersion 999' },
    ]);
    expect(g.what.toLowerCase()).toContain('different version');
  });

  it('gives generic dataset guidance for unrelated JSON', () => {
    const text = JSON.stringify({ hello: 'world' });
    const g = buildDatasetImportErrorGuidance(text, [
      { code: 'wrong-snapshot-kind', message: 'kind mismatch' },
    ]);
    expect(g.title.length).toBeGreaterThan(0);
    expect(g.tryThis).toContain('Export Dataset');
  });
});

// ---------------------------------------------------------------------------
// Scraped Roster import guidance
// ---------------------------------------------------------------------------

describe('buildScrapedImportErrorGuidance', () => {
  it('handles an empty file', () => {
    const g = buildScrapedImportErrorGuidance({
      kind: 'parse',
      reason: 'empty-file',
      message: 'The selected file is empty.',
    });
    expect(g.title.toLowerCase()).toContain('empty');
  });

  it('handles invalid JSON', () => {
    const g = buildScrapedImportErrorGuidance({
      kind: 'parse',
      reason: 'invalid-json',
      message: 'bad token',
    });
    expect(g.what.toLowerCase()).toContain("isn't valid json");
    expect(g.detail).toBe('bad token');
  });

  it('detects a dataset export dropped into Roster import and points to Import Dataset', () => {
    const payload = JSON.parse(validSnapshotJson());
    const g = buildScrapedImportErrorGuidance({ kind: 'invalid-source', payload });
    expect(g.what).toContain('UC Roster Sniffer dataset');
    expect(g.tryThis).toContain('Import Dataset');
  });

  it('explains an unsupported scraped record type', () => {
    const p = playersPayload();
    (p.metadata as { record_type: string }).record_type = 'banners';
    const g = buildScrapedImportErrorGuidance({ kind: 'invalid-source', payload: p });
    expect(g.what).toContain('record_type');
  });

  it('gives generic scraped guidance for unrelated JSON', () => {
    const g = buildScrapedImportErrorGuidance({ kind: 'invalid-source', payload: { x: 1 } });
    expect(g.tryThis).toContain('Import Dataset');
  });
});

// ---------------------------------------------------------------------------
// Existing valid imports still parse (guidance never loosens validation)
// ---------------------------------------------------------------------------

describe('valid files still parse/classify correctly', () => {
  it('a valid dataset export still parses ok', () => {
    expect(parseWorkspaceSnapshotJson(validSnapshotJson()).ok).toBe(true);
  });

  it('valid scraped players/coaches still classify as scraped (not rejected as datasets)', () => {
    expect(classifyImportFileShape(playersPayload())).toBe('scraped-players');
    expect(classifyImportFileShape(coachesPayload())).toBe('scraped-coaches');
  });
});
