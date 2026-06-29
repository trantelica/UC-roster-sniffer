import { describe, it, expect } from 'vitest';
import {
  normalizeUteConferenceImportSource,
  inferSeasonYearFromFileName,
} from '../engine/uteConferenceImportSourceNormalization';
import { createUteScrapedJsonImportSessionFromPayload } from '../engine/uteConferenceScrapedJsonImportSession';
import { buildWholeFilePlayerImportPlan } from '../engine/uteConferenceScrapedJsonWholeFileImport';
import { listUteConferenceScrapedJsonTeamTargets } from '../engine/uteConferenceScrapedJsonAdapter';

// The product-owner's real flat shape, plus a second team and district to exercise grouping.
const flatPlayers = [
  { district: 'Alta', age_group: 'GI League 12', team: 'GridIron A3', player_name: 'Cary, Hudson' },
  { district: 'Alta', age_group: 'GI League 12', team: 'GridIron A3', player_name: '  Lee, Sam ' },
  { district: 'Alta', age_group: 'GI League 12', team: 'GridIron B1', player_name: 'Park, Jamie' },
  { district: 'Brighton', age_group: 'GI League 12', team: 'GridIron A1', player_name: 'Nguyen, Bao' },
];

function okResult(payload: unknown, fileName?: string) {
  const r = normalizeUteConferenceImportSource(payload, { fileName });
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r;
}

describe('normalizeUteConferenceImportSource — flat players', () => {
  it('normalizes a flat player row-list into the nested scraped players payload', () => {
    const r = okResult(flatPlayers, 'ute-players-2025.json');
    expect(r.classification).toBe('flat-players');
    expect(r.changed).toBe(true);
    const payload = r.payload as { metadata: Record<string, unknown>; districts: unknown[] };
    expect(payload.metadata.record_type).toBe('players');
    expect(payload.districts).toHaveLength(2); // Alta, Brighton (first-seen order)
  });

  it('preserves player names EXACTLY (comma names and surrounding spacing)', () => {
    const r = okResult(flatPlayers, 'ute-players-2025.json');
    const payload = r.payload as {
      districts: { district: string; teams: { team_name: string; players: { name: string }[] }[] }[];
    };
    const alta = payload.districts.find((d) => d.district === 'Alta')!;
    const a3 = alta.teams.find((t) => t.team_name === 'GridIron A3')!;
    expect(a3.players.map((p) => p.name)).toEqual(['Cary, Hudson', '  Lee, Sam ']);
  });

  it('groups deterministically by district + age group + team, preserving row order', () => {
    const r = okResult(flatPlayers, 'ute-players-2025.json');
    const payload = r.payload as {
      districts: { district: string; teams: { team_name: string }[] }[];
    };
    const alta = payload.districts.find((d) => d.district === 'Alta')!;
    expect(alta.teams.map((t) => t.team_name)).toEqual(['GridIron A3', 'GridIron B1']);
    const brighton = payload.districts.find((d) => d.district === 'Brighton')!;
    expect(brighton.teams.map((t) => t.team_name)).toEqual(['GridIron A1']);
  });

  it('infers the season year from the filename and the age-division alias (GI League 12 -> GI)', () => {
    const r = okResult(flatPlayers, 'ute-players-2025.json');
    const meta = (r.payload as { metadata: Record<string, unknown> }).metadata;
    expect(meta.year).toBe('2025');
    expect(meta.event).toBe('2025 Season');
    expect(meta.age_division).toBe('GI League 12');
    expect(meta.age_division_alias).toBe('GI');
    expect(r.inferred.year).toBe(true);
    expect(r.inferred.ageDivisionAlias).toBe(true);
  });

  it('warns (but still imports) when no year is in the filename', () => {
    const r = okResult(flatPlayers, 'players.json');
    expect(r.inferred.year).toBe(false);
    expect(r.warnings.some((w) => w.code === 'year-not-inferred')).toBe(true);
    expect((r.payload as { metadata: Record<string, unknown> }).metadata.year).toBeUndefined();
  });

  it('warns on mixed age groups but still groups what it can', () => {
    const mixed = [
      { district: 'Alta', age_group: 'GI League 12', team: 'GridIron A3', player_name: 'A' },
      { district: 'Alta', age_group: 'MM League 11', team: 'MityMite A1', player_name: 'B' },
    ];
    const r = okResult(mixed, 'ute-2025.json');
    expect(r.warnings.some((w) => w.code === 'mixed-age-groups')).toBe(true);
    expect((r.payload as { metadata: Record<string, unknown> }).metadata.age_division).toBeUndefined();
  });

  it('fails clearly on flat rows missing required keys', () => {
    const r = normalizeUteConferenceImportSource([{ district: 'Alta', team: 'GridIron A3' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unsupported-flat-rows');
  });

  it('fails clearly on an empty list', () => {
    const r = normalizeUteConferenceImportSource([]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('empty-source');
  });

  it('does not mutate the input payload', () => {
    const json = JSON.stringify(flatPlayers);
    normalizeUteConferenceImportSource(flatPlayers, { fileName: 'ute-players-2025.json' });
    expect(JSON.stringify(flatPlayers)).toBe(json);
  });
});

describe('normalizeUteConferenceImportSource — pass-through', () => {
  it('passes a nested players payload through unchanged', () => {
    const nested = {
      metadata: { record_type: 'players', year: 2026 },
      districts: [{ district: 'Alta', teams: [{ team_name: 'GridIron A3', players: [{ name: 'A' }] }] }],
    };
    const r = okResult(nested);
    expect(r.classification).toBe('nested-players');
    expect(r.changed).toBe(false);
    expect(r.payload).toBe(nested);
  });

  it('passes a nested coaches payload through unchanged', () => {
    const nested = {
      metadata: { record_type: 'coaches', year: 2026 },
      districts: [{ district: 'Alta', teams: [{ team_name: 'GridIron A3', coaches: [{ name: 'C', title: 'Head' }] }] }],
    };
    const r = okResult(nested);
    expect(r.classification).toBe('nested-coaches');
    expect(r.changed).toBe(false);
    expect(r.payload).toBe(nested);
  });
});

describe('normalizeUteConferenceImportSource — flat coaches', () => {
  it('normalizes flat coach rows, preserving name and title exactly', () => {
    const rows = [
      { district: 'Alta', age_group: 'GI League 12', team: 'GridIron A3', coach_name: 'Smith, Pat', coach_title: 'Head Coach' },
    ];
    const r = okResult(rows, 'ute-coaches-2025.json');
    expect(r.classification).toBe('flat-coaches');
    const payload = r.payload as {
      metadata: Record<string, unknown>;
      districts: { teams: { coaches: { name: string; title?: string }[] }[] }[];
    };
    expect(payload.metadata.record_type).toBe('coaches');
    expect(payload.districts[0].teams[0].coaches[0]).toEqual({ name: 'Smith, Pat', title: 'Head Coach' });
  });
});

describe('normalized flat players feed the existing import path end-to-end', () => {
  it('produces selectable team targets grouped by district/team', () => {
    const r = okResult(flatPlayers, 'ute-players-2025.json');
    const targets = listUteConferenceScrapedJsonTeamTargets(r.payload);
    expect(targets.map((t) => `${t.districtName}/${t.teamName}`)).toEqual([
      'Alta/GridIron A3',
      'Alta/GridIron B1',
      'Brighton/GridIron A1',
    ]);
    const session = createUteScrapedJsonImportSessionFromPayload(r.payload);
    expect(session.recordType).toBe('players');
  });

  it('whole-file player import can plan against the normalized payload', () => {
    const r = okResult(flatPlayers, 'ute-players-2025.json');
    const plan = buildWholeFilePlayerImportPlan({ payload: r.payload, existingTeams: [] });
    expect(plan.isPlayerFile).toBe(true);
    expect(plan.playerTargetCount).toBe(3);
  });
});

describe('inferSeasonYearFromFileName', () => {
  it('extracts a clear 4-digit year', () => {
    expect(inferSeasonYearFromFileName('ute-players-2025.json')).toBe('2025');
    expect(inferSeasonYearFromFileName('2024_fall.json')).toBe('2024');
  });
  it('returns null when there is no clear year', () => {
    expect(inferSeasonYearFromFileName('players.json')).toBeNull();
    expect(inferSeasonYearFromFileName(undefined)).toBeNull();
    expect(inferSeasonYearFromFileName('roster-12.json')).toBeNull();
  });
});
