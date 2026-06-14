import { describe, it, expect } from 'vitest';
import {
  createEmptyUteScrapedJsonImportSession,
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
  clearUteScrapedJsonImportSessionTarget,
  summarizeUteScrapedJsonImportSession,
  getSelectedUteScrapedJsonImportSessionTarget,
  getUteScrapedJsonImportSessionSelectableTargets,
} from '../engine/uteConferenceScrapedJsonImportSession';
import * as sessionModule from '../engine/uteConferenceScrapedJsonImportSession';

import playersPw from './fixtures/ute-scraped-json/players-2023-pw-small.json';
import coachesPw from './fixtures/ute-scraped-json/coaches-2022-pw-small.json';
import playersEmpty from './fixtures/ute-scraped-json/players-empty-league-small.json';
import playersColor from './fixtures/ute-scraped-json/players-color-team-small.json';
import playersCoded from './fixtures/ute-scraped-json/players-coded-classification-small.json';

// ---------------------------------------------------------------------------
// Inline payloads for blocked / needs-review cases (mirrors the readiness tests).
// ---------------------------------------------------------------------------

function blockedPlayerPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'PW League 10',
      age_division_alias: 'PW',
      year: 2025,
      record_type: 'players',
      source_url: 'https://ute.example/blocked',
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

function needsReviewCoachPayload() {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: 'Fall',
      age_division: 'PW League 10',
      age_division_alias: 'PW',
      year: 2025,
      record_type: 'coaches',
      source_url: 'https://ute.example/coach-review',
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
            coaches_count: 1,
            coaches: [{ name: 'John Smith', title: '   ' }],
          },
        ],
      },
    ],
  };
}

/** First selectable target id from a loaded session. */
function firstSelectableId(session: ReturnType<typeof createUteScrapedJsonImportSessionFromPayload>) {
  return getUteScrapedJsonImportSessionSelectableTargets(session)[0].sourceTargetId;
}

// ---------------------------------------------------------------------------
// 1-9. construction / loading
// ---------------------------------------------------------------------------

describe('session construction', () => {
  it('1. creates an empty session with uninitialized status', () => {
    const session = createEmptyUteScrapedJsonImportSession();
    expect(session.status).toBe('uninitialized');
    expect(session.recordType).toBe('unknown');
    expect(session.readinessReport).toBeNull();
    expect(session.selectedTarget).toBeNull();
    expect(session.summary.totalTargets).toBe(0);
    expect(session.summary.canSelectTarget).toBe(false);
  });

  it('2. loading a valid player payload creates a source-loaded session', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    expect(session.status).toBe('source-loaded');
    expect(session.recordType).toBe('players');
    expect(session.selectedTarget).toBeNull();
    expect(session.summary.totalTargets).toBe(2);
  });

  it('3. loading a valid coach payload creates a source-loaded session', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(coachesPw);
    expect(session.status).toBe('source-loaded');
    expect(session.recordType).toBe('coaches');
    expect(session.summary.totalTargets).toBe(2);
  });

  it('4. loading an unsupported source creates an invalid-source session', () => {
    const session = createUteScrapedJsonImportSessionFromPayload({
      metadata: { record_type: 'banners' },
      districts: [],
    });
    expect(session.status).toBe('invalid-source');
    expect(session.recordType).toBe('unknown');
    expect(session.issues.map((i) => i.code)).toContain('invalid-source');
    expect(session.summary.canSelectTarget).toBe(false);
  });

  it('5. loading an empty player league creates source-loaded with zero selectable targets', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersEmpty);
    expect(session.status).toBe('source-loaded');
    expect(session.summary.totalTargets).toBe(0);
    expect(session.summary.selectableTargets).toBe(0);
    expect(getUteScrapedJsonImportSessionSelectableTargets(session)).toEqual([]);
  });

  it('6. a readiness report is present after a payload load', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    expect(session.readinessReport).not.toBeNull();
    expect(session.readinessReport?.recordType).toBe('players');
    expect(session.sourceSummary?.totalRows).toBe(4);
  });

  it('7. the source fingerprint is deterministic across repeated calls', () => {
    const a = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const b = createUteScrapedJsonImportSessionFromPayload(playersPw);
    expect(a.sourceFingerprint).toBe(b.sourceFingerprint);
    expect(a.sourceFingerprint).not.toBe('');
    // A different source yields a different fingerprint.
    const c = createUteScrapedJsonImportSessionFromPayload(coachesPw);
    expect(c.sourceFingerprint).not.toBe(a.sourceFingerprint);
  });

  it('8. player selectable targets come from the readiness report', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const selectable = getUteScrapedJsonImportSessionSelectableTargets(session);
    expect(selectable.map((t) => t.teamName)).toEqual(['PeeWee C1', 'PeeWee A3']);
  });

  it('9. coach selectable targets come from the readiness report', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(coachesPw);
    const selectable = getUteScrapedJsonImportSessionSelectableTargets(session);
    expect(selectable.map((t) => t.teamName)).toEqual(['PeeWee C1', 'PeeWee A3']);
  });
});

// ---------------------------------------------------------------------------
// 10-19. player + coach selection
// ---------------------------------------------------------------------------

describe('player target selection', () => {
  it('10. selects a valid player target and stores the selected target', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const id = firstSelectableId(session);
    const next = selectUteScrapedJsonImportSessionTarget(session, id);
    expect(next.selectedSourceTargetId).toBe(id);
    expect(next.selectedTarget?.recordType).toBe('players');
    expect(next.status).toBe('ready-for-preview');
    expect(getSelectedUteScrapedJsonImportSessionTarget(next)).toBe(next.selectedTarget);
  });

  it('11. a selected player target stores the canonical mapping', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const next = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    expect(next.selectedCanonicalContextMapping).not.toBeNull();
    expect(next.selectedCanonicalContextMapping?.canonicalContext.ageDivisionId).toBe('PW');
  });

  it('12. a selected player target stores the preview input and result', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const next = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    expect(next.selectedPlayerPreviewInput?.rows.length).toBe(2);
    expect(next.selectedPlayerPreviewResult?.ok).toBe(true);
    expect(next.selectedCoachPreviewResult).toBeNull();
  });

  it('13. a selected player target preserves comma player names exactly', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const next = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    const names = next.selectedPlayerPreviewResult?.rows.map((r) => r.playerName);
    expect(names).toContain('Cary, Hudson');
  });

  it('14. a selected player target preserves extra-space player names exactly', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const next = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    const names = next.selectedPlayerPreviewResult?.rows.map((r) => r.playerName);
    expect(names).toContain('Moyer , Knox');
  });
});

describe('coach target selection', () => {
  it('15. selects a valid coach target and stores the coach preview result', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(coachesPw);
    const id = firstSelectableId(session);
    const next = selectUteScrapedJsonImportSessionTarget(session, id);
    expect(next.selectedCoachPreviewResult).not.toBeNull();
    expect(next.selectedCoachPreviewResult?.rows.length).toBe(2);
    expect(next.selectedPlayerPreviewResult).toBeNull();
  });

  it('16. a selected coach target preserves a non-breaking-space coach name', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(coachesPw);
    const next = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    const names = next.selectedCoachPreviewResult?.rows.map((r) => r.rawName);
    const NBSP = '\u00A0';
    expect(names).toContain(`John${NBSP}Smith`);
    expect(names?.some((n) => n?.includes(NBSP))).toBe(true);
  });

  it('17. a selected coach target preserves coach titles', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(coachesPw);
    const next = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    const titles = next.selectedCoachPreviewResult?.rows.map((r) => r.rawTitle);
    expect(titles).toEqual(['Head Coach', 'Asst Coach']);
  });
});

describe('classification mapping on selection', () => {
  it('18. selecting a coded-classification target exposes the classification mapping', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersCoded);
    const next = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    const cls = next.selectedCanonicalContextMapping?.teamClassification;
    expect(cls?.canonicalValue).toBe('A2');
    expect(cls?.hierarchyCode).toBe('A');
  });

  it('19. selecting a color / non-coded target does not invent a classification', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersColor);
    const next = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    const cls = next.selectedCanonicalContextMapping?.teamClassification;
    expect(cls?.canonicalValue).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 20-24. blocked / missing / clearing / idempotency / overrides
// ---------------------------------------------------------------------------

describe('blocked, missing, clearing, overrides', () => {
  it('20. selecting a blocked target sets target-blocked status', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(blockedPlayerPayload());
    const blocked = session.readinessReport!.targets.find(
      (t) => t.readinessStatus === 'blocked'
    )!;
    const next = selectUteScrapedJsonImportSessionTarget(session, blocked.sourceTargetId);
    expect(next.status).toBe('target-blocked');
    expect(next.selectedTarget?.issues.map((i) => i.code)).toContain('target-blocked');
    expect(next.summary.canProceedToPreview).toBe(false);
  });

  it('21. selecting a missing target reports target-not-found', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const next = selectUteScrapedJsonImportSessionTarget(session, 'scraped:does:not:0:9');
    expect(next.selectedTarget).toBeNull();
    expect(next.status).toBe('source-loaded');
    expect(next.issues.map((i) => i.code)).toContain('target-not-found');
  });

  it('22. clearing a target preserves the readiness report and clears the selection', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const selected = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    const cleared = clearUteScrapedJsonImportSessionTarget(selected);
    expect(cleared.selectedTarget).toBeNull();
    expect(cleared.selectedCanonicalContextMapping).toBeNull();
    expect(cleared.selectedPlayerPreviewResult).toBeNull();
    expect(cleared.status).toBe('source-loaded');
    expect(cleared.readinessReport).toBe(selected.readinessReport);
  });

  it('23. re-selecting the same target is idempotent', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const id = firstSelectableId(session);
    const a = selectUteScrapedJsonImportSessionTarget(session, id);
    const b = selectUteScrapedJsonImportSessionTarget(a, id);
    expect(b).toEqual(a);
  });

  it('24. target overrides can alter the selected canonical context', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersColor);
    const id = firstSelectableId(session);
    const base = selectUteScrapedJsonImportSessionTarget(session, id);
    expect(base.selectedCanonicalContextMapping?.canonicalContext.teamClassification).toBeNull();
    const overridden = selectUteScrapedJsonImportSessionTarget(session, id, {
      override: { teamClassification: 'B2' },
    });
    expect(
      overridden.selectedCanonicalContextMapping?.canonicalContext.teamClassification
    ).toBe('B2');
  });
});

// ---------------------------------------------------------------------------
// 25-27. summary flags
// ---------------------------------------------------------------------------

describe('session summary flags', () => {
  it('25. the session summary reflects the selected target', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const id = firstSelectableId(session);
    const next = selectUteScrapedJsonImportSessionTarget(session, id);
    const summary = summarizeUteScrapedJsonImportSession(next);
    expect(summary.selectedSourceTargetId).toBe(id);
    expect(summary.selectedStatus).toBe(next.selectedTarget?.readinessStatus);
    expect(summary.selectedRowCount).toBe(2);
  });

  it('26. canProceedToPreview is true only when the selected target is usable', () => {
    const ready = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const readyNext = selectUteScrapedJsonImportSessionTarget(ready, firstSelectableId(ready));
    expect(readyNext.summary.canProceedToPreview).toBe(true);

    const blockedSession = createUteScrapedJsonImportSessionFromPayload(blockedPlayerPayload());
    const blocked = blockedSession.readinessReport!.targets.find(
      (t) => t.readinessStatus === 'blocked'
    )!;
    const blockedNext = selectUteScrapedJsonImportSessionTarget(
      blockedSession,
      blocked.sourceTargetId
    );
    expect(blockedNext.summary.canProceedToPreview).toBe(false);
  });

  it('27. canProceedWithoutReview is false when the selected target needs review or is blocked', () => {
    const reviewSession = createUteScrapedJsonImportSessionFromPayload(needsReviewCoachPayload());
    const review = reviewSession.readinessReport!.targets.find(
      (t) => t.readinessStatus === 'needs-review'
    )!;
    const reviewNext = selectUteScrapedJsonImportSessionTarget(
      reviewSession,
      review.sourceTargetId
    );
    expect(reviewNext.status).toBe('ready-for-review');
    expect(reviewNext.summary.canProceedToPreview).toBe(true);
    expect(reviewNext.summary.canProceedWithoutReview).toBe(false);

    const ready = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const readyNext = selectUteScrapedJsonImportSessionTarget(ready, firstSelectableId(ready));
    expect(readyNext.summary.canProceedWithoutReview).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 28-33. purity / no side effects
// ---------------------------------------------------------------------------

describe('purity and absence of side effects', () => {
  it('28. the input payload is not mutated', () => {
    const payload = playersPw;
    const before = JSON.stringify(payload);
    const session = createUteScrapedJsonImportSessionFromPayload(payload);
    selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    expect(JSON.stringify(payload)).toBe(before);
  });

  it('29. the previous session object is not mutated by select / clear', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const snapshot = JSON.stringify({
      status: session.status,
      selectedSourceTargetId: session.selectedSourceTargetId,
      issues: session.issues,
    });
    const selected = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    clearUteScrapedJsonImportSessionTarget(selected);
    expect(
      JSON.stringify({
        status: session.status,
        selectedSourceTargetId: session.selectedSourceTargetId,
        issues: session.issues,
      })
    ).toBe(snapshot);
    expect(session.selectedTarget).toBeNull();
    expect(selected.selectedTarget).not.toBeNull();
  });

  it('30. output is deterministic across repeated calls', () => {
    const a = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const b = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const id = firstSelectableId(a);
    const sa = selectUteScrapedJsonImportSessionTarget(a, id);
    const sb = selectUteScrapedJsonImportSessionTarget(b, id);
    expect(sa.summary).toEqual(sb.summary);
    expect(sa.selectedCanonicalContextMapping).toEqual(sb.selectedCanonicalContextMapping);
  });

  it('31. the module exposes no import apply / write behavior', () => {
    const names = Object.keys(sessionModule);
    const forbidden = names.filter((n) => /apply|commit|write|persist|save|upload|delete/i.test(n));
    expect(forbidden).toEqual([]);
  });

  it('32. no roster records are created or mutated (preview only)', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const next = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session));
    // The selection produces a preview result, never a committed roster.
    expect(next.selectedPlayerPreviewResult).not.toBeNull();
    expect('rosterRecords' in next).toBe(false);
    expect('appliedRows' in next).toBe(false);
  });

  it('33. no UI / browser / persistence APIs are introduced', () => {
    const fns = Object.values(sessionModule).filter((v) => typeof v === 'function');
    for (const fn of fns) {
      const src = fn.toString();
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.|window\.|fetch\(/);
    }
  });
});

// ---------------------------------------------------------------------------
// fingerprint-mismatch guard (selection behavior requirement)
// ---------------------------------------------------------------------------

describe('source fingerprint guard', () => {
  it('selecting with a mismatched expected fingerprint fails deterministically', () => {
    const session = createUteScrapedJsonImportSessionFromPayload(playersPw);
    const next = selectUteScrapedJsonImportSessionTarget(session, firstSelectableId(session), {
      expectedSourceFingerprint: 'ute-scraped-session-deadbeef',
    });
    expect(next.selectedTarget).toBeNull();
    expect(next.issues.map((i) => i.code)).toContain('source-fingerprint-mismatch');
  });
});
