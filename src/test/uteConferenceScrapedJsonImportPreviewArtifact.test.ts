import { describe, it, expect } from 'vitest';
import type { Team } from '../domain/types';
import {
  createUteScrapedJsonImportSessionFromPayload,
  selectUteScrapedJsonImportSessionTarget,
  getUteScrapedJsonImportSessionSelectableTargets,
} from '../engine/uteConferenceScrapedJsonImportSession';
import {
  buildScrapedJsonImportRosterAwareReview,
  findExistingRosterTeamForContext,
  type ScrapedImportReviewDecisionMap,
  type ScrapedImportRosterAwareReview,
} from '../engine/uteConferenceScrapedJsonImportRosterAwareReview';
import { buildScrapedJsonImportStagedProjection } from '../engine/uteConferenceScrapedJsonImportStagedProjection';
import { buildScrapedJsonImportFutureCommitReadiness } from '../engine/uteConferenceScrapedJsonImportFutureReadiness';
import {
  buildScrapedJsonImportPreviewArtifact,
  SCRAPED_JSON_IMPORT_PREVIEW_ARTIFACT_KIND,
} from '../engine/uteConferenceScrapedJsonImportPreviewArtifact';
import { buildScrapedJsonImportTransactionPlan } from '../engine/uteConferenceScrapedJsonImportTransactionPlan';

function playerPayload(playerNames: string[]) {
  return {
    metadata: {
      organization: 'Ute Conference',
      event: '2026 Fall Season',
      age_division: 'GR League 9',
      age_division_alias: 'GR',
      year: 2026,
      record_type: 'players',
      source_url: 'https://ute.example/2026/gr',
    },
    districts: [
      {
        district: 'Alta',
        league: 'GR League 9',
        teams_count: 1,
        teams: [
          {
            team_name: 'Gremlin B1',
            source_url: 'https://ute.example/2026/gr/b1',
            players_count: playerNames.length,
            players: playerNames.map((name) => ({ name })),
          },
        ],
      },
    ],
  };
}

function existingTeam(playerNames: string[]): Team {
  return {
    teamId: '2026-alta-GR-B1',
    seasonId: '2026',
    districtId: 'alta',
    ageDivisionId: 'GR',
    teamCode: 'B1',
    draftOrder: 1,
    divisionTeamCount: 1,
    headCoach: null,
    assistantCoaches: [],
    players: playerNames.map((name) => ({ name })),
  };
}

function buildAll(
  payload: unknown,
  teams: Team[],
  decisions: ScrapedImportReviewDecisionMap = {}
) {
  const loaded = createUteScrapedJsonImportSessionFromPayload(payload);
  const id = getUteScrapedJsonImportSessionSelectableTargets(loaded)[0].sourceTargetId;
  const session = selectUteScrapedJsonImportSessionTarget(loaded, id);
  const review = buildScrapedJsonImportRosterAwareReview(session, teams, decisions);
  const ctx = session.selectedCanonicalContextMapping!.canonicalContext;
  const team = findExistingRosterTeamForContext(teams, {
    seasonId: ctx.seasonId,
    districtId: ctx.districtId,
    ageDivisionId: ctx.ageDivisionId,
    teamClassification: ctx.teamClassification,
  });
  const staged = buildScrapedJsonImportStagedProjection(review, team);
  const readiness = buildScrapedJsonImportFutureCommitReadiness(review, staged);
  return { review, staged, readiness };
}

function rowIdByName(review: ScrapedImportRosterAwareReview, name: string) {
  if (!review.available) throw new Error('review unavailable');
  return review.rows.find((r) => r.playerName === name)!.sourceRowId!;
}

const TEAM = [existingTeam(['Jordan Smith', 'Taylor Johnson'])];

const SOURCE = {
  name: 'demo.json',
  kind: 'players',
  organization: 'Ute Conference',
  event: '2026 Fall Season',
  year: '2026',
};
const TARGET = {
  teamName: 'Gremlin B1',
  existingTeamId: '2026-alta-GR-B1',
  seasonId: '2026',
  districtId: 'alta',
  ageDivisionId: 'GR',
  teamClassification: 'B1',
};

describe('scraped JSON import preview artifact', () => {
  it('builds a preview-only artifact with readiness, staged, and row summaries', () => {
    const { review, staged, readiness } = buildAll(
      playerPayload(['Brand New']),
      TEAM
    );
    const artifact = buildScrapedJsonImportPreviewArtifact({
      generatedAt: '2026-06-19T00:00:00.000Z',
      source: SOURCE,
      target: TARGET,
      review,
      stagedProjection: staged,
      readiness,
    });

    expect(artifact.artifactKind).toBe(SCRAPED_JSON_IMPORT_PREVIEW_ARTIFACT_KIND);
    expect(artifact.previewOnly).toBe(true);
    expect(artifact.note).toMatch(/preview only/i);
    expect(artifact.generatedAt).toBe('2026-06-19T00:00:00.000Z');
    expect(artifact.reviewAvailable).toBe(true);
    expect(artifact.source).toEqual(SOURCE);
    expect(artifact.target).toEqual(TARGET);

    expect(artifact.readiness.isReadyForFutureCommit).toBe(true);
    expect(artifact.readiness.readyAdditions).toBe(1);
    expect(artifact.readiness.totalIncomingRows).toBe(1);
    expect(artifact.readiness.totalProjectedRosterRows).toBe(3);
    expect(artifact.readiness.blockingReasonCodes).toEqual([]);

    expect(artifact.stagedProjection.stageable).toBe(true);
    if (artifact.stagedProjection.stageable) {
      expect(artifact.stagedProjection.projectedRosterCount).toBe(3);
    }

    expect(artifact.rows).toEqual([
      {
        rowIndex: 0,
        importedName: 'Brand New',
        matchStatus: 'likely-new',
        outcome: 'projected-create',
        decision: null,
        linkTargetExistingName: null,
      },
    ]);
  });

  it('captures a linked row and its link target in the row statuses', () => {
    const r0 = buildAll(playerPayload(['Jordan Smith']), TEAM).review;
    const decisions: ScrapedImportReviewDecisionMap = {
      [rowIdByName(r0, 'Jordan Smith')]: 'confirm-match',
    };
    const { review, staged, readiness } = buildAll(
      playerPayload(['Jordan Smith']),
      TEAM,
      decisions
    );
    const artifact = buildScrapedJsonImportPreviewArtifact({
      generatedAt: '2026-06-19T00:00:00.000Z',
      source: SOURCE,
      target: TARGET,
      review,
      stagedProjection: staged,
      readiness,
    });
    expect(artifact.rows[0].outcome).toBe('projected-link');
    expect(artifact.rows[0].decision).toBe('confirm-match');
    expect(artifact.rows[0].linkTargetExistingName).toBe('Jordan Smith');
    expect(artifact.readiness.readyLinks).toBe(1);
  });

  it('records an unavailable / not-staged state without inventing rows', () => {
    const { review, staged, readiness } = buildAll(playerPayload(['Brand New']), []);
    const artifact = buildScrapedJsonImportPreviewArtifact({
      generatedAt: '2026-06-19T00:00:00.000Z',
      source: SOURCE,
      target: { ...TARGET, existingTeamId: null },
      review,
      stagedProjection: staged,
      readiness,
    });
    expect(artifact.reviewAvailable).toBe(false);
    expect(artifact.rows).toEqual([]);
    expect(artifact.stagedProjection.stageable).toBe(false);
    expect(artifact.readiness.isReadyForFutureCommit).toBe(false);
    expect(artifact.readiness.blockingReasonCodes).toContain('review-unavailable');
  });

  it('is deterministic and never mutates its inputs', () => {
    const { review, staged, readiness } = buildAll(
      playerPayload(['Brand New']),
      TEAM
    );
    const reviewBefore = JSON.stringify(review);
    const stagedBefore = JSON.stringify(staged);
    const readinessBefore = JSON.stringify(readiness);
    const input = {
      generatedAt: '2026-06-19T00:00:00.000Z',
      source: SOURCE,
      target: TARGET,
      review,
      stagedProjection: staged,
      readiness,
    };
    const a = buildScrapedJsonImportPreviewArtifact(input);
    const b = buildScrapedJsonImportPreviewArtifact(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(review)).toBe(reviewBefore);
    expect(JSON.stringify(staged)).toBe(stagedBefore);
    expect(JSON.stringify(readiness)).toBe(readinessBefore);
  });

  it('omits the transaction plan (null) when none is supplied', () => {
    const { review, staged, readiness } = buildAll(playerPayload(['Brand New']), TEAM);
    const artifact = buildScrapedJsonImportPreviewArtifact({
      generatedAt: '2026-06-19T00:00:00.000Z',
      source: SOURCE,
      target: TARGET,
      review,
      stagedProjection: staged,
      readiness,
    });
    expect(artifact.transactionPlan).toBeNull();
  });

  it('includes the transaction plan summary, marked not executed, when supplied', () => {
    const { review, staged, readiness } = buildAll(playerPayload(['Brand New']), TEAM);
    const transactionPlan = buildScrapedJsonImportTransactionPlan({
      transactionId: 'txn-art-1',
      generatedAt: '2026-06-19T00:00:00.000Z',
      source: SOURCE,
      target: TARGET,
      review,
      stagedProjection: staged,
      readiness,
    });
    const artifact = buildScrapedJsonImportPreviewArtifact({
      generatedAt: '2026-06-19T00:00:00.000Z',
      source: SOURCE,
      target: TARGET,
      review,
      stagedProjection: staged,
      readiness,
      transactionPlan,
    });
    expect(artifact.transactionPlan).toEqual({
      status: 'planned',
      executed: false,
      transactionId: 'txn-art-1',
      generatedAt: '2026-06-19T00:00:00.000Z',
      addCount: 1,
      linkCount: 0,
      deferredCount: 0,
      rejectedCount: 0,
      netRosterRecordChange: 1,
      blockingReasonCodes: [],
    });
  });

  it('summarizes a rejected transaction plan with blocking codes and null delta', () => {
    // No existing roster -> review unavailable -> readiness not ready -> rejected plan.
    const { review, staged, readiness } = buildAll(playerPayload(['Brand New']), []);
    const transactionPlan = buildScrapedJsonImportTransactionPlan({
      transactionId: 'txn-art-2',
      generatedAt: '2026-06-19T00:00:00.000Z',
      source: SOURCE,
      target: { ...TARGET, existingTeamId: null },
      review,
      stagedProjection: staged,
      readiness,
    });
    const artifact = buildScrapedJsonImportPreviewArtifact({
      generatedAt: '2026-06-19T00:00:00.000Z',
      source: SOURCE,
      target: { ...TARGET, existingTeamId: null },
      review,
      stagedProjection: staged,
      readiness,
      transactionPlan,
    });
    expect(artifact.transactionPlan?.status).toBe('rejected');
    expect(artifact.transactionPlan?.executed).toBe(false);
    expect(artifact.transactionPlan?.netRosterRecordChange).toBeNull();
    expect(artifact.transactionPlan?.blockingReasonCodes).toContain('review-unavailable');
  });
});
