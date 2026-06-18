import { describe, it, expect } from 'vitest';
import {
  createEmptyUteScrapedJsonImportSession,
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
  getUteScrapedJsonImportSessionSelectableTargets,
} from '../engine/uteConferenceScrapedJsonImportSession';
import { buildScrapedJsonImportPreviewViewModel } from '../app/scrapedImportPreviewViewModel';

import playersPw from './fixtures/ute-scraped-json/players-2023-pw-small.json';
import coachesPw from './fixtures/ute-scraped-json/coaches-2022-pw-small.json';
import playersEmpty from './fixtures/ute-scraped-json/players-empty-league-small.json';

function blockedPlayerPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'PW League 10',
      age_division_alias: 'PW',
      year: 2025,
      record_type: 'players',
      source_url: 'https://ute.example/blocked-view-model',
    },
    districts: [
      {
        district: 'Alta',
        league: 'PW League 10',
        teams_count: 1,
        teams: [
          {
            team_name: 'PeeWee C1',
            source_url: 'https://ute.example/alta/c1',
            players_count: 1,
            players: [{ name: '   ' }],
          },
        ],
      },
    ],
  };
}

function firstSelectableId(session: ReturnType<typeof createUteScrapedJsonImportSessionFromPayload>) {
  return getUteScrapedJsonImportSessionSelectableTargets(session)[0].sourceTargetId;
}

describe('scraped JSON import preview view model', () => {
  it('uninitialized empty session renders no source and no targets', () => {
    const vm = buildScrapedJsonImportPreviewViewModel(
      createEmptyUteScrapedJsonImportSession()
    );
    expect(vm.status).toBe('uninitialized');
    expect(vm.invalidSource).toBe(false);
    expect(vm.source).toBeNull();
    expect(vm.selectableTargets).toEqual([]);
    expect(vm.hasSelection).toBe(false);
    expect(vm.selected).toBeNull();
  });

  it('loaded player source exposes source summary and selectable targets, no selection', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const vm = buildScrapedJsonImportPreviewViewModel(session);

    expect(vm.status).toBe('source-loaded');
    expect(vm.recordType).toBe('players');
    expect(vm.source?.year).toBe('2023');
    expect(vm.source?.totalTeams).toBe(2);
    expect(vm.summary.selectableTargets).toBe(2);
    expect(vm.selectableTargets.map((t) => t.teamName)).toEqual(['PeeWee C1', 'PeeWee A3']);
    expect(vm.hasSelection).toBe(false);
  });

  it('invalid / unsupported source is flagged and exposes no selectable targets', () => {
    const session = createUteScrapedJsonImportSessionFromPayload({
      metadata: { record_type: 'banners' },
      districts: [],
    });
    const vm = buildScrapedJsonImportPreviewViewModel(session);

    expect(vm.status).toBe('invalid-source');
    expect(vm.invalidSource).toBe(true);
    expect(vm.summary.canSelectTarget).toBe(false);
    expect(vm.selectableTargets).toEqual([]);
  });

  it('empty league exposes zero targets and is not selectable', () => {
    const vm = buildScrapedJsonImportPreviewViewModel(
      createUteScrapedJsonImportSessionFromPayload(playersEmpty)
    );
    expect(vm.status).toBe('source-loaded');
    expect(vm.summary.totalTargets).toBe(0);
    expect(vm.selectableTargets).toEqual([]);
    expect(vm.summary.canSelectTarget).toBe(false);
  });

  it('selected player target exposes importable preview rows, canonical context, and review summary', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const selected = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    const vm = buildScrapedJsonImportPreviewViewModel(selected);

    expect(vm.hasSelection).toBe(true);
    expect(vm.selected?.recordType).toBe('players');
    expect(vm.selected?.importable).toBe(true);
    expect(vm.selected?.blocked).toBe(false);
    expect(vm.selected?.empty).toBe(false);
    // Read-only preview rows preserve raw names and source order.
    expect(vm.selected?.playerPreviewRows.map((r) => r.playerName)).toEqual([
      'Cary, Hudson',
      'Moyer , Knox',
    ]);
    expect(vm.selected?.canonicalContext?.ageDivisionId).toBe('PW');
    // No decisions held -> all rows unreviewed in the read-only shell.
    expect(vm.selected?.reviewSummary?.unreviewedRowCount).toBe(2);
    expect(vm.selected?.reviewSummary?.reviewedRowCount).toBe(0);
  });

  it('selected coach target has no player preview rows or review summary', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(coachesPw);
    const selected = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    const vm = buildScrapedJsonImportPreviewViewModel(selected);

    expect(vm.selected?.recordType).toBe('coaches');
    expect(vm.selected?.playerPreviewRows).toEqual([]);
    expect(vm.selected?.reviewSummary).toBeNull();
  });

  it('selected blocked target is shown as not importable', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(blockedPlayerPayload());
    const blocked = session.readinessReport!.targets.find(
      (t) => t.readinessStatus === 'blocked'
    )!;
    const selected = selectUteScrapedJsonImportSessionTarget(session, blocked.sourceTargetId);
    const vm = buildScrapedJsonImportPreviewViewModel(selected);

    expect(vm.selected?.blocked).toBe(true);
    expect(vm.selected?.importable).toBe(false);
    expect(vm.summary.canProceedToPreview).toBe(false);
    expect(vm.blockedTargets.length).toBe(1);
  });

  it('is deterministic across repeated builds', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const selected = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    expect(buildScrapedJsonImportPreviewViewModel(selected)).toEqual(
      buildScrapedJsonImportPreviewViewModel(selected)
    );
  });
});
