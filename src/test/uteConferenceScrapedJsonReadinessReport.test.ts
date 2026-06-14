import { describe, it, expect } from 'vitest';
import {
  createUteConferenceScrapedJsonReadinessReport,
  summarizeUteConferenceScrapedJsonReadinessReport,
  getUteScrapedJsonImportReadyTargets,
  getUteScrapedJsonTargetsNeedingReview,
  getUteScrapedJsonBlockedTargets,
  getUteScrapedJsonEmptyTargets,
} from '../engine/uteConferenceScrapedJsonReadinessReport';

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
      source_url: 'https://ute.example/players',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GI League 12',
        teams_count: 4,
        teams: [
          {
            team_name: 'GridIron A3',
            source_url: 'https://ute.example/alta/a3',
            players_count: 2,
            players: [{ name: 'Cary, Hudson' }, { name: 'Sam Lee' }],
          },
          {
            team_name: 'GridIron B1',
            source_url: 'https://ute.example/alta/b1',
            players_count: 0,
            players: [],
          },
          {
            team_name: 'GridIron C1',
            source_url: 'https://ute.example/alta/c1',
            players_count: 1,
            players: [{ name: '   ' }],
          },
          {
            team_name: 'Scout White',
            source_url: 'https://ute.example/alta/sw',
            players_count: 5,
            players: [{ name: 'Al Pha' }, { name: 'Be Ta' }],
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
      age_division: 'GR League 9',
      year: 2025,
      record_type: 'coaches',
      source_url: 'https://ute.example/coaches',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GR League 9',
        teams_count: 3,
        teams: [
          {
            team_name: 'Gremlin A2',
            source_url: 'https://ute.example/alta/a2',
            coaches_count: 2,
            coaches: [
              { name: 'John Smith', title: 'Head Coach' },
              { name: 'John Smith', title: 'Head Coach' },
            ],
          },
          {
            team_name: 'Gremlin B1',
            source_url: 'https://ute.example/alta/b1',
            coaches_count: 1,
            coaches: [{ name: 'Jane Doe', title: '' }],
          },
          {
            team_name: 'Gremlin D2',
            source_url: 'https://ute.example/alta/d2',
            coaches_count: 1,
            coaches: [{ name: 'John Smith', title: 'Assistant' }],
          },
        ],
      },
    ],
  };
}

function emptyTeamPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'GR League 9',
      year: 2025,
      record_type: 'players',
      source_url: 'https://ute.example/players',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GR League 9',
        teams_count: 1,
        teams: [
          {
            team_name: 'Gremlin A1',
            source_url: 'https://ute.example/alta/a1',
            players_count: 0,
            players: [],
          },
        ],
      },
    ],
  };
}

function findByTeamName(
  report: ReturnType<typeof createUteConferenceScrapedJsonReadinessReport>,
  teamName: string
) {
  const t = report.targets.find((x) => x.teamName === teamName);
  if (!t) throw new Error(`target not found: ${teamName}`);
  return t;
}

// ---------------------------------------------------------------------------
// 1-6. report basics
// ---------------------------------------------------------------------------

describe('readiness report basics', () => {
  it('1. creates a readiness report for a player payload', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    expect(report.recordType).toBe('players');
    expect(report.ok).toBe(true);
    expect(report.targets).toHaveLength(4);
  });

  it('2. creates a readiness report for a coach payload', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(coachPayload());
    expect(report.recordType).toBe('coaches');
    expect(report.ok).toBe(true);
    expect(report.targets).toHaveLength(3);
  });

  it('3. unsupported record_type creates a blocked source issue', () => {
    const payload = { ...playerPayload(), metadata: { ...playerPayload().metadata, record_type: 'referees' } };
    const report = createUteConferenceScrapedJsonReadinessReport(payload);
    expect(report.recordType).toBe('unknown');
    expect(report.ok).toBe(false);
    expect(report.issues.map((i) => i.code)).toContain('unsupported-record-type');
    expect(report.targets).toHaveLength(0);
    expect(report.summary.canProceedToTeamSelection).toBe(false);
  });

  it('4. a valid empty-team snapshot reports ok and an empty status', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(emptyTeamPayload());
    expect(report.ok).toBe(true);
    expect(report.targets).toHaveLength(1);
    expect(report.targets[0].readinessStatus).toBe('empty');
    expect(report.summary.emptyTargets).toBe(1);
    expect(report.summary.canProceedToTeamSelection).toBe(false);
  });

  it('5. preserves source target order', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    expect(report.targets.map((t) => t.teamName)).toEqual([
      'GridIron A3',
      'GridIron B1',
      'GridIron C1',
      'Scout White',
    ]);
  });

  it('6. summarizes total targets and rows', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    expect(report.summary.totalTargets).toBe(4);
    // 2 (A3) + 0 (B1) + 1 (C1) + 2 (Scout White) = 5 rows; all player rows.
    expect(report.summary.totalRows).toBe(5);
    expect(report.summary.playerRows).toBe(5);
    expect(report.summary.coachRows).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7-9. player readiness
// ---------------------------------------------------------------------------

describe('player readiness', () => {
  it('7. a valid player team is ready-with-warnings (provisional district)', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const a3 = findByTeamName(report, 'GridIron A3');
    expect(a3.readinessStatus).toBe('ready-with-warnings');
    expect(a3.readinessReasons).toContain('valid-player-preview');
    expect(a3.readinessReasons).toContain('provisional-district');
    expect(a3.canonicalAgeDivisionId).toBe('GI');
  });

  it('8. comma names are preserved through the preview', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const a3 = findByTeamName(report, 'GridIron A3');
    // The preview summary counts the two players; the comma name is preserved in the
    // underlying preview (a clean, ready row, never split).
    expect(a3.previewSummary?.totalRows).toBe(2);
    expect(a3.previewSummary?.readyRows).toBe(2);
    expect(a3.previewSummary?.invalidRows).toBe(0);
  });

  it('9. a missing player name blocks the player target (invalid rows)', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const c1 = findByTeamName(report, 'GridIron C1');
    expect(c1.readinessStatus).toBe('blocked');
    expect(c1.readinessReasons).toContain('missing-player-name');
    expect(c1.rowCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 10-13. coach readiness
// ---------------------------------------------------------------------------

describe('coach readiness', () => {
  it('10. a valid coach team is ready-with-warnings (provisional district)', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(coachPayload());
    const a2 = findByTeamName(report, 'Gremlin A2');
    expect(a2.readinessStatus).toBe('ready-with-warnings');
    expect(a2.readinessReasons).toContain('valid-coach-preview');
    expect(a2.canonicalAgeDivisionId).toBe('GR');
  });

  it('11. a non-breaking-space coach name is counted present and preserved in source', () => {
    const payload = coachPayload();
    const report = createUteConferenceScrapedJsonReadinessReport(payload);
    const d2 = findByTeamName(report, 'Gremlin D2');
    expect(d2.coachPreviewSummary?.withName).toBe(1);
    expect(d2.coachPreviewSummary?.missingName).toBe(0);
    // Source value is left untouched (non-breaking space preserved).
    expect(payload.districts[0].teams[2].coaches[0].name).toBe('John Smith');
  });

  it('12. a missing coach title makes the coach target needs-review', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(coachPayload());
    const b1 = findByTeamName(report, 'Gremlin B1');
    expect(b1.readinessStatus).toBe('needs-review');
    expect(b1.readinessReasons).toContain('missing-coach-title');
  });

  it('13. duplicate coach rows are preserved (never de-duplicated)', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(coachPayload());
    const a2 = findByTeamName(report, 'Gremlin A2');
    expect(a2.coachPreviewSummary?.totalRows).toBe(2);
    expect(a2.rowCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 14-17. mapping confidence / classification / overrides
// ---------------------------------------------------------------------------

describe('mapping reasons and overrides', () => {
  it('14. provisional district appears as a warning reason, not corruption', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    expect(report.ok).toBe(true);
    const a3 = findByTeamName(report, 'GridIron A3');
    expect(a3.targetContextProvisional).toBe(true);
    expect(a3.readinessReasons).toContain('provisional-district');
  });

  it('15. an unknown color team classification is a warning reason, not invented', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const sw = findByTeamName(report, 'Scout White');
    expect(sw.teamClassification).toBeNull();
    expect(sw.readinessReasons).toContain('color-team-classification-unknown');
    expect(['ready-with-warnings', 'needs-review']).toContain(sw.readinessStatus);
  });

  it('16. an explicit coded classification appears on the readiness target', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const a3 = findByTeamName(report, 'GridIron A3');
    expect(a3.teamClassification).toBe('A3');
    expect(a3.classificationHierarchyCode).toBe('A');
  });

  it('17. a caller override can move a provisional target to higher confidence', () => {
    const base = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const a3Id = findByTeamName(base, 'GridIron A3').sourceTargetId;
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload(), {
      targetContextOverridesBySourceTargetId: {
        [a3Id]: { districtId: 'alta', teamId: '2025-alta-gi-a3' },
      },
    });
    const a3 = findByTeamName(report, 'GridIron A3');
    expect(a3.contextConfidence).toBe('high');
    expect(a3.targetContextProvisional).toBe(false);
    expect(a3.readinessReasons).not.toContain('provisional-district');
    expect(a3.readinessStatus).toBe('ready');
  });
});

// ---------------------------------------------------------------------------
// 18-20. blocked source / counts
// ---------------------------------------------------------------------------

describe('source issues and counts', () => {
  it('18. invalid payload surfaces a source issue and does not throw', () => {
    expect(() => createUteConferenceScrapedJsonReadinessReport(null)).not.toThrow();
    const report = createUteConferenceScrapedJsonReadinessReport(null);
    expect(report.ok).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.summary.canProceedToTeamSelection).toBe(false);
  });

  it('19. count mismatch is a warning by default (target stays usable)', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const sw = findByTeamName(report, 'Scout White');
    expect(sw.readinessReasons).toContain('count-mismatch');
    expect(sw.readinessStatus).toBe('ready-with-warnings');
  });

  it('20. strictCounts=true elevates a count mismatch to needs-review (rows preserved)', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload(), {
      strictCounts: true,
    });
    const sw = findByTeamName(report, 'Scout White');
    expect(sw.readinessStatus).toBe('needs-review');
    expect(sw.readinessReasons).toContain('count-mismatch');
    expect(sw.rowCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 21-24. filter helpers
// ---------------------------------------------------------------------------

describe('filter helpers', () => {
  it('21. import-ready helper returns ready and ready-with-warnings only', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const ready = getUteScrapedJsonImportReadyTargets(report);
    expect(ready.map((t) => t.teamName).sort()).toEqual(['GridIron A3', 'Scout White']);
    expect(
      ready.every(
        (t) =>
          t.readinessStatus === 'ready' ||
          t.readinessStatus === 'ready-with-warnings'
      )
    ).toBe(true);
  });

  it('22. needs-review helper returns needs-review only', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(coachPayload());
    const review = getUteScrapedJsonTargetsNeedingReview(report);
    expect(review.map((t) => t.teamName)).toEqual(['Gremlin B1']);
  });

  it('23. blocked helper returns blocked only', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const blocked = getUteScrapedJsonBlockedTargets(report);
    expect(blocked.map((t) => t.teamName)).toEqual(['GridIron C1']);
  });

  it('24. empty helper returns empty only', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const empty = getUteScrapedJsonEmptyTargets(report);
    expect(empty.map((t) => t.teamName)).toEqual(['GridIron B1']);
  });
});

// ---------------------------------------------------------------------------
// 25-26. proceed flags
// ---------------------------------------------------------------------------

describe('proceed flags', () => {
  it('25. canProceedToTeamSelection is true when usable targets exist', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    expect(report.summary.canProceedToTeamSelection).toBe(true);
  });

  it('26. canProceedWithoutReview is false when any target is blocked or needs review', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    // playerPayload has a blocked target (C1), so review is required.
    expect(report.summary.canProceedWithoutReview).toBe(false);

    // A clean override-only file with a single ready target can proceed without review.
    const clean = {
      metadata: {
        organization: 'Ute Conference',
        event: 'Fall',
        age_division: 'GridIron League 12',
        age_division_alias: 'GI',
        year: 2025,
        record_type: 'players',
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
              players_count: 1,
              players: [{ name: 'Sam Lee' }],
            },
          ],
        },
      ],
    };
    const base = createUteConferenceScrapedJsonReadinessReport(clean);
    const id = base.targets[0].sourceTargetId;
    const report2 = createUteConferenceScrapedJsonReadinessReport(clean, {
      targetContextOverridesBySourceTargetId: {
        [id]: { districtId: 'alta', teamId: '2025-alta-gi-a3' },
      },
    });
    expect(report2.targets[0].readinessStatus).toBe('ready');
    expect(report2.summary.canProceedWithoutReview).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 27-31. robustness / purity / summarize
// ---------------------------------------------------------------------------

describe('robustness and purity', () => {
  it('27. a non-object payload does not throw', () => {
    expect(() => createUteConferenceScrapedJsonReadinessReport('nope')).not.toThrow();
    expect(createUteConferenceScrapedJsonReadinessReport('nope').ok).toBe(false);
  });

  it('28. does not mutate the input payload', () => {
    const payload = playerPayload();
    const before = JSON.parse(JSON.stringify(payload));
    createUteConferenceScrapedJsonReadinessReport(payload, { strictCounts: true });
    expect(JSON.parse(JSON.stringify(payload))).toEqual(before);
  });

  it('29. produces deterministic output across repeated calls', () => {
    const a = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    const b = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    expect(a).toEqual(b);

    const c = createUteConferenceScrapedJsonReadinessReport(coachPayload());
    const d = createUteConferenceScrapedJsonReadinessReport(coachPayload());
    expect(c).toEqual(d);
  });

  it('30. the standalone summarize helper matches the report summary', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload());
    expect(summarizeUteConferenceScrapedJsonReadinessReport(report)).toEqual(
      report.summary
    );
  });

  it('31. includeEmptyTeams=false omits empty targets', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playerPayload(), {
      includeEmptyTeams: false,
    });
    expect(report.targets.map((t) => t.teamName)).toEqual([
      'GridIron A3',
      'GridIron C1',
      'Scout White',
    ]);
    expect(report.summary.emptyTargets).toBe(0);
  });
});
