import { describe, it, expect } from 'vitest';
import {
  detectUteConferenceScrapedJsonRecordType,
  summarizeUteConferenceScrapedJson,
  listUteConferenceScrapedJsonTeamTargets,
  createCoachImportPreviewInputFromScrapedJson,
} from '../engine/uteConferenceScrapedJsonAdapter';
import * as adapterModule from '../engine/uteConferenceScrapedJsonAdapter';
import {
  mapUteScrapedTeamTargetToCanonicalContext,
  createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext,
} from '../engine/uteConferenceScrapedCanonicalMapping';
import * as mappingModule from '../engine/uteConferenceScrapedCanonicalMapping';
import { createUteConferenceScrapedJsonReadinessReport } from '../engine/uteConferenceScrapedJsonReadinessReport';
import * as readinessModule from '../engine/uteConferenceScrapedJsonReadinessReport';

import playersPw from './fixtures/ute-scraped-json/players-2023-pw-small.json';
import coachesPw from './fixtures/ute-scraped-json/coaches-2022-pw-small.json';
import playersEmpty from './fixtures/ute-scraped-json/players-empty-league-small.json';
import coachesEmpty from './fixtures/ute-scraped-json/coaches-empty-league-small.json';
import playersColor from './fixtures/ute-scraped-json/players-color-team-small.json';
import playersCoded from './fixtures/ute-scraped-json/players-coded-classification-small.json';

const TEAM_0 = { districtIndex: 0, teamIndex: 0 };
const READINESS_STATUSES = [
  'ready',
  'ready-with-warnings',
  'needs-review',
  'blocked',
  'empty',
];

// ---------------------------------------------------------------------------
// 1-2. record-type detection
// ---------------------------------------------------------------------------

describe('record-type detection', () => {
  it('1. player fixture is detected as players', () => {
    expect(detectUteConferenceScrapedJsonRecordType(playersPw)).toBe('players');
  });

  it('2. coach fixture is detected as coaches', () => {
    expect(detectUteConferenceScrapedJsonRecordType(coachesPw)).toBe('coaches');
  });
});

// ---------------------------------------------------------------------------
// 3-4. summaries match metadata totals
// ---------------------------------------------------------------------------

describe('summary totals', () => {
  it('3. player fixture summary matches metadata totals', () => {
    const summary = summarizeUteConferenceScrapedJson(playersPw);
    expect(summary.recordType).toBe('players');
    expect(summary.year).toBe('2023');
    expect(summary.totalTeams).toBe(2);
    expect(summary.totalRows).toBe(4);
    expect(summary.ok).toBe(true);
  });

  it('4. coach fixture summary matches metadata totals', () => {
    const summary = summarizeUteConferenceScrapedJson(coachesPw);
    expect(summary.recordType).toBe('coaches');
    expect(summary.year).toBe('2022');
    expect(summary.totalTeams).toBe(2);
    expect(summary.totalRows).toBe(3);
    expect(summary.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5-6. team-target order preserved
// ---------------------------------------------------------------------------

describe('team-target order', () => {
  it('5. player fixture team targets preserve source order', () => {
    const targets = listUteConferenceScrapedJsonTeamTargets(playersPw);
    expect(targets.map((t) => t.teamName)).toEqual(['PeeWee C1', 'PeeWee A3']);
  });

  it('6. coach fixture team targets preserve source order', () => {
    const targets = listUteConferenceScrapedJsonTeamTargets(coachesPw);
    expect(targets.map((t) => t.teamName)).toEqual(['PeeWee C1', 'PeeWee A3']);
  });
});

// ---------------------------------------------------------------------------
// 7-8. player names preserved exactly
// ---------------------------------------------------------------------------

describe('player name preservation', () => {
  it('7. comma name "Cary, Hudson" is preserved through preview input/result', () => {
    const r = createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(
      playersPw,
      TEAM_0
    );
    expect(r.previewInput.rows[0].playerName).toBe('Cary, Hudson');
    expect(r.previewResult?.rows[0].playerName).toBe('Cary, Hudson');
  });

  it('8. extra-space name "Moyer , Knox" is preserved through preview input/result', () => {
    const r = createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(
      playersPw,
      TEAM_0
    );
    expect(r.previewInput.rows[1].playerName).toBe('Moyer , Knox');
    expect(r.previewResult?.rows[1].playerName).toBe('Moyer , Knox');
  });
});

// ---------------------------------------------------------------------------
// 9-10. coach names/titles preserved exactly
// ---------------------------------------------------------------------------

describe('coach name/title preservation', () => {
  it('9. non-breaking-space coach name is preserved through coach preview', () => {
    const coach = createCoachImportPreviewInputFromScrapedJson(coachesPw, TEAM_0);
    expect(coach.rows[0].rawName).toBe('John\u00A0Smith');
    expect(coach.rows[0].rawName).not.toBe('John Smith');
  });

  it('10. coach titles are preserved exactly', () => {
    const coach = createCoachImportPreviewInputFromScrapedJson(coachesPw, TEAM_0);
    expect(coach.rows[0].rawTitle).toBe('Head Coach');
    expect(coach.rows[1].rawTitle).toBe('Asst Coach');
  });
});

// ---------------------------------------------------------------------------
// 11-12. classification mapping
// ---------------------------------------------------------------------------

describe('classification mapping', () => {
  it('11. coded-classification fixture maps the explicit classification', () => {
    const mapping = mapUteScrapedTeamTargetToCanonicalContext(playersCoded, TEAM_0);
    expect(mapping.teamClassification.canonicalValue).toBe('A2');
    expect(mapping.teamClassification.hierarchyCode).toBe('A');
    expect(mapping.canonicalContext.teamClassification).toBe('A2');
  });

  it('12. color-team fixture leaves classification unknown and invents nothing', () => {
    const mapping = mapUteScrapedTeamTargetToCanonicalContext(playersColor, TEAM_0);
    expect(mapping.teamClassification.canonicalValue).toBeNull();
    expect(mapping.teamClassification.hierarchyCode).toBeNull();
    expect(mapping.teamClassification.issues.map((i) => i.code)).toContain(
      'color-team-classification-unknown'
    );
  });
});

// ---------------------------------------------------------------------------
// 13-14. empty snapshots are valid source data
// ---------------------------------------------------------------------------

describe('empty league snapshots', () => {
  it('13. empty player league fixture is valid empty source data', () => {
    const summary = summarizeUteConferenceScrapedJson(playersEmpty);
    expect(summary.recordType).toBe('players');
    expect(summary.ok).toBe(true);
    expect(summary.totalTeams).toBe(0);
    expect(listUteConferenceScrapedJsonTeamTargets(playersEmpty)).toHaveLength(0);
  });

  it('14. empty coach league fixture is valid empty source data', () => {
    const summary = summarizeUteConferenceScrapedJson(coachesEmpty);
    expect(summary.recordType).toBe('coaches');
    expect(summary.ok).toBe(true);
    expect(summary.totalTeams).toBe(0);
    expect(listUteConferenceScrapedJsonTeamTargets(coachesEmpty)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 15-17. readiness report over fixtures
// ---------------------------------------------------------------------------

describe('readiness report', () => {
  it('15. player fixture produces usable target statuses', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(playersPw);
    expect(report.ok).toBe(true);
    expect(report.targets).toHaveLength(2);
    expect(
      report.targets.every((t) => READINESS_STATUSES.includes(t.readinessStatus))
    ).toBe(true);
    expect(report.summary.canProceedToTeamSelection).toBe(true);
  });

  it('16. coach fixture produces usable target statuses', () => {
    const report = createUteConferenceScrapedJsonReadinessReport(coachesPw);
    expect(report.ok).toBe(true);
    expect(report.targets).toHaveLength(2);
    expect(
      report.targets.every((t) => READINESS_STATUSES.includes(t.readinessStatus))
    ).toBe(true);
    expect(report.summary.canProceedToTeamSelection).toBe(true);
  });

  it('17. empty fixtures produce a valid report without throwing', () => {
    expect(() =>
      createUteConferenceScrapedJsonReadinessReport(playersEmpty)
    ).not.toThrow();
    const playerReport = createUteConferenceScrapedJsonReadinessReport(playersEmpty);
    expect(playerReport.ok).toBe(true);
    expect(playerReport.targets).toHaveLength(0);
    expect(playerReport.summary.canProceedToTeamSelection).toBe(false);

    const coachReport = createUteConferenceScrapedJsonReadinessReport(coachesEmpty);
    expect(coachReport.ok).toBe(true);
    expect(coachReport.targets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 18-20. purity and no-apply guarantees
// ---------------------------------------------------------------------------

describe('purity and boundaries', () => {
  it('18. fixture payloads are not mutated by adapter/mapping/readiness helpers', () => {
    const fixtures = [
      playersPw,
      coachesPw,
      playersEmpty,
      coachesEmpty,
      playersColor,
      playersCoded,
    ];
    const before = fixtures.map((f) => JSON.stringify(f));

    for (const fixture of fixtures) {
      detectUteConferenceScrapedJsonRecordType(fixture);
      summarizeUteConferenceScrapedJson(fixture);
      listUteConferenceScrapedJsonTeamTargets(fixture);
      mapUteScrapedTeamTargetToCanonicalContext(fixture, TEAM_0);
      createPlayerRosterImportPreviewInputFromScrapedJsonWithCanonicalContext(
        fixture,
        TEAM_0
      );
      createCoachImportPreviewInputFromScrapedJson(fixture, TEAM_0);
      createUteConferenceScrapedJsonReadinessReport(fixture, { strictCounts: true });
    }

    expect(fixtures.map((f) => JSON.stringify(f))).toEqual(before);
  });

  it('19. produces deterministic output across repeated calls', () => {
    expect(createUteConferenceScrapedJsonReadinessReport(playersPw)).toEqual(
      createUteConferenceScrapedJsonReadinessReport(playersPw)
    );
    expect(createUteConferenceScrapedJsonReadinessReport(coachesPw)).toEqual(
      createUteConferenceScrapedJsonReadinessReport(coachesPw)
    );
  });

  it('20. the scraped JSON engine modules expose no apply/commit/write/persist API', () => {
    const forbidden = /(apply|commit|write|persist|save|mutate|delete)/i;
    const exported = [
      ...Object.keys(adapterModule),
      ...Object.keys(mappingModule),
      ...Object.keys(readinessModule),
    ];
    expect(exported.filter((name) => forbidden.test(name))).toEqual([]);
  });
});
