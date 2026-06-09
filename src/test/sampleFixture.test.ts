import { describe, it, expect } from 'vitest';
import { loadSampleData } from '../data/loadSampleData';
import { getDistinctSeasons } from '../engine/filters';
import {
  findPriorSeasonTeam,
  summarizeTeamRosterStatus,
} from '../engine/teamRosterStatusSummary';

// ---------------------------------------------------------------------------
// Multi-season sample fixture: verifies the bundled sample data can drive the
// selected-team roster status summary into an available state with real data.
// These tests read derived metadata only; they never assert that any source
// player record was removed, merged, or rewritten.
// ---------------------------------------------------------------------------

const CURRENT_SEASON = '2026';
const SAME_SLOT_TEAM_ID = '2026-alta-GR-B1';

describe('multi-season sample fixture', () => {
  it('includes at least two seasons', () => {
    const { teams } = loadSampleData();
    const seasons = getDistinctSeasons(teams);
    expect(seasons.length).toBeGreaterThanOrEqual(2);
    expect(seasons).toContain('2025');
    expect(seasons).toContain('2026');
  });

  it('includes a prior-season same-slot team for the selected current team', () => {
    const { teams } = loadSampleData();
    const current = teams.find((t) => t.teamId === SAME_SLOT_TEAM_ID);
    expect(current).toBeDefined();
    if (!current) return;
    expect(current.seasonId).toBe(CURRENT_SEASON);

    const prior = findPriorSeasonTeam(teams, current);
    expect(prior).not.toBeNull();
    if (!prior) return;
    // Same slot: same district, age division, and team code in an earlier season.
    expect(prior.seasonId).toBe('2025');
    expect(prior.districtId).toBe(current.districtId);
    expect(prior.ageDivisionId).toBe(current.ageDivisionId);
    expect(prior.teamCode).toBe(current.teamCode);
  });

  it('derives an available selected-team status summary from the fixture', () => {
    const { teams } = loadSampleData();
    const current = teams.find((t) => t.teamId === SAME_SLOT_TEAM_ID)!;
    const prior = findPriorSeasonTeam(teams, current);

    const result = summarizeTeamRosterStatus(current.players, prior?.players ?? null);
    expect(result.available).toBe(true);
  });

  it('produces non-zero returning, new, notReturning, and unknown counts', () => {
    const { teams } = loadSampleData();
    const current = teams.find((t) => t.teamId === SAME_SLOT_TEAM_ID)!;
    const prior = findPriorSeasonTeam(teams, current);

    const result = summarizeTeamRosterStatus(current.players, prior?.players ?? null);
    expect(result.available).toBe(true);
    if (!result.available) return;

    const { summary } = result;
    expect(summary.returning).toBeGreaterThan(0);
    expect(summary.new).toBeGreaterThan(0);
    expect(summary.notReturning).toBeGreaterThan(0);
    expect(summary.unknown).toBeGreaterThan(0);

    // Perspective-aware invariant: confidence partitions the displayed records.
    expect(summary.highConfidence + summary.lowConfidence).toBe(summary.total);
    expect(summary.total).toBe(
      summary.returning + summary.new + summary.notReturning + summary.unknown
    );
  });

  it('preserves ambiguous duplicate player records in the source roster', () => {
    const { teams } = loadSampleData();
    const current = teams.find((t) => t.teamId === SAME_SLOT_TEAM_ID)!;

    // The ambiguous duplicate must remain present in the roster (data is
    // authoritative); ambiguity only affects derived metadata.
    const jamie = current.players.filter((p) => p.name === 'Jamie Park');
    expect(jamie.length).toBe(2);
  });

  it('keeps the existing viewer behavior: an earlier season has no prior comparison', () => {
    const { teams } = loadSampleData();
    const priorTeam = teams.find((t) => t.teamId === '2025-alta-GR-B1')!;
    const result = summarizeTeamRosterStatus(
      priorTeam.players,
      findPriorSeasonTeam(teams, priorTeam)?.players ?? null
    );
    expect(result).toEqual({ available: false, reason: 'no-prior-season' });
  });
});
