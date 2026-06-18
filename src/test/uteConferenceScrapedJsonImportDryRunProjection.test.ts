import { describe, it, expect } from 'vitest';
import {
  createEmptyUteScrapedJsonImportSession,
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
  getUteScrapedJsonImportSessionSelectableTargets,
} from '../engine/uteConferenceScrapedJsonImportSession';
import type { UteScrapedJsonImportSession } from '../engine/uteConferenceScrapedJsonImportSession';
import { buildScrapedJsonImportDryRunProjection } from '../engine/uteConferenceScrapedJsonImportDryRunProjection';

import playersPw from './fixtures/ute-scraped-json/players-2023-pw-small.json';
import coachesPw from './fixtures/ute-scraped-json/coaches-2022-pw-small.json';

function firstSelectableId(session: ReturnType<typeof createUteScrapedJsonImportSessionFromPayload>) {
  return getUteScrapedJsonImportSessionSelectableTargets(session)[0].sourceTargetId;
}

function selectedPlayerSession() {
  const loaded = createUteScrapedJsonImportSessionFromPayload(playersPw);
  return selectUteScrapedJsonImportSessionTarget(loaded, firstSelectableId(loaded));
}

function blockedPlayerPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'PW League 10',
      age_division_alias: 'PW',
      year: 2025,
      record_type: 'players',
      source_url: 'https://ute.example/blocked-dryrun',
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

describe('scraped JSON import dry-run projection', () => {
  it('no selection is deterministically unavailable', () => {
    const result = buildScrapedJsonImportDryRunProjection(
      createUteScrapedJsonImportSessionFromPayload(playersPw)
    );
    expect(result).toEqual(
      buildScrapedJsonImportDryRunProjection(
        createUteScrapedJsonImportSessionFromPayload(playersPw)
      )
    );
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('no-selection');
  });

  it('empty/uninitialized session is unavailable (no selection)', () => {
    const result = buildScrapedJsonImportDryRunProjection(
      createEmptyUteScrapedJsonImportSession()
    );
    expect(result.available).toBe(false);
  });

  it('ready player target produces a deterministic available projection (all create-new)', () => {
    const session = selectedPlayerSession();
    const a = buildScrapedJsonImportDryRunProjection(session);
    const b = buildScrapedJsonImportDryRunProjection(session);
    expect(a).toEqual(b);
    expect(a.available).toBe(true);
    if (a.available) {
      expect(a.assumption).toBe('new-import-no-existing-roster');
      expect(a.summary.projectedCreateRows).toBe(2);
      expect(a.summary.projectedLinkRows).toBe(0);
      expect(a.rows.map((r) => r.projectionStatus)).toEqual([
        'projected-create',
        'projected-create',
      ]);
    }
  });

  it('preserves raw player names exactly in the projection (comma + spacing)', () => {
    const result = buildScrapedJsonImportDryRunProjection(selectedPlayerSession());
    expect(result.available).toBe(true);
    if (result.available) {
      expect(result.rows.map((r) => r.playerName)).toEqual(['Cary, Hudson', 'Moyer , Knox']);
      expect(result.rows.map((r) => r.projectedNewPlayerName)).toEqual([
        'Cary, Hudson',
        'Moyer , Knox',
      ]);
    }
  });

  it('coach target is unavailable (not part of player-roster projection)', () => {
    const loaded = createUteScrapedJsonImportSessionFromPayload(coachesPw);
    const selected = selectUteScrapedJsonImportSessionTarget(loaded, firstSelectableId(loaded));
    const result = buildScrapedJsonImportDryRunProjection(selected);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('coach-target-not-projectable');
  });

  it('blocked target is unavailable and does not bypass readiness', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(blockedPlayerPayload());
    const blocked = session.readinessReport!.targets.find(
      (t) => t.readinessStatus === 'blocked'
    )!;
    const selected = selectUteScrapedJsonImportSessionTarget(session, blocked.sourceTargetId);
    const result = buildScrapedJsonImportDryRunProjection(selected);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('target-blocked');
  });

  it('missing canonical target context is unavailable', () => {
    const base = selectedPlayerSession();
    // Craft a session whose selected target lacks a canonical teamId.
    const mapping = base.selectedCanonicalContextMapping!;
    const crafted = {
      ...base,
      selectedCanonicalContextMapping: {
        ...mapping,
        canonicalContext: { ...mapping.canonicalContext, teamId: null },
      },
    } as unknown as UteScrapedJsonImportSession;
    const result = buildScrapedJsonImportDryRunProjection(crafted);
    expect(result.available).toBe(false);
    if (!result.available) expect(result.reason).toBe('missing-target-context');
  });

  it('does not mutate the source payload', () => {
    const before = JSON.stringify(playersPw);
    buildScrapedJsonImportDryRunProjection(selectedPlayerSession());
    expect(JSON.stringify(playersPw)).toBe(before);
  });
});
