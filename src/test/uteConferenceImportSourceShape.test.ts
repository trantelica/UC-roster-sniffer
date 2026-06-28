import { describe, it, expect } from 'vitest';
import { classifyUteConferenceImportSource } from '../engine/uteConferenceImportSourceShape';

const flatPlayerRow = {
  district: 'Alta',
  age_group: 'GI League 12',
  team: 'GridIron A3',
  player_name: 'Cary, Hudson',
};

const nestedPlayers = {
  metadata: { record_type: 'players' },
  districts: [{ district: 'Alta', teams: [{ team_name: 'GridIron A3', players: [{ name: 'A' }] }] }],
};

const nestedCoaches = {
  metadata: { record_type: 'coaches' },
  districts: [{ district: 'Alta', teams: [{ team_name: 'GridIron A3', coaches: [{ name: 'C', title: 'Head' }] }] }],
};

describe('classifyUteConferenceImportSource', () => {
  it('classifies nested players / coaches payloads', () => {
    expect(classifyUteConferenceImportSource(nestedPlayers)).toBe('nested-players');
    expect(classifyUteConferenceImportSource(nestedCoaches)).toBe('nested-coaches');
  });

  it('classifies a valid flat player row-list', () => {
    expect(classifyUteConferenceImportSource([flatPlayerRow])).toBe('flat-players');
  });

  it('accepts flat-player key aliases (district_name / ageDivision / league / team_name / name)', () => {
    expect(
      classifyUteConferenceImportSource([
        { district_name: 'Alta', ageDivision: 'GI', team_name: 'GridIron A3', name: 'Cary, Hudson' },
      ])
    ).toBe('flat-players');
    expect(
      classifyUteConferenceImportSource([
        { district: 'Alta', league: 'GI League 12', team: 'GridIron A3', player: 'Cary, Hudson' },
      ])
    ).toBe('flat-players');
  });

  it('classifies a flat coach row-list when explicit coach signals are present', () => {
    expect(
      classifyUteConferenceImportSource([
        { district: 'Alta', age_group: 'GI League 12', team: 'GridIron A3', coach_name: 'Smith, Pat', coach_title: 'Head Coach' },
      ])
    ).toBe('flat-coaches');
  });

  it('treats a generic-name flat row-list as players (the primary path)', () => {
    expect(
      classifyUteConferenceImportSource([
        { district: 'Alta', age_group: 'GI League 12', team: 'GridIron A3', name: 'Cary, Hudson' },
      ])
    ).toBe('flat-players');
  });

  it('classifies flat rows missing required keys as unsupported', () => {
    expect(classifyUteConferenceImportSource([{ district: 'Alta', team: 'GridIron A3' }])).toBe(
      'flat-unsupported'
    );
    expect(classifyUteConferenceImportSource([{ player_name: 'X' }])).toBe('flat-unsupported');
    expect(classifyUteConferenceImportSource([1, 2, 3])).toBe('flat-unsupported');
  });

  it('classifies an empty array as empty-source', () => {
    expect(classifyUteConferenceImportSource([])).toBe('empty-source');
  });

  it('classifies a UC Roster Sniffer dataset export as dataset', () => {
    expect(classifyUteConferenceImportSource({ snapshotKind: 'workspace', schemaVersion: 1, workspace: {} })).toBe('dataset');
  });

  it('classifies unrelated objects as unknown', () => {
    expect(classifyUteConferenceImportSource({ hello: 'world' })).toBe('unknown');
    expect(classifyUteConferenceImportSource('nope')).toBe('unknown');
  });

  it('does not mutate the payload', () => {
    const rows = [flatPlayerRow];
    const json = JSON.stringify(rows);
    classifyUteConferenceImportSource(rows);
    expect(JSON.stringify(rows)).toBe(json);
  });
});
