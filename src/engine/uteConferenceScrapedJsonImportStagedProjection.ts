import type { Team } from '../domain/types';
import type { ScrapedImportRosterAwareReview } from './uteConferenceScrapedJsonImportRosterAwareReview';

/**
 * Phase 5 slice 19: PURE, deterministic STAGED in-memory roster projection — ENGINE
 * ONLY.
 *
 * It answers: "given a CLEAN slice 18 roster-aware dry run, what would the post-import
 * roster look like — in memory only — so the user can inspect it before any permanent
 * import/apply/save exists?"
 *
 * It COMPOSES the slice 18 review (`buildScrapedJsonImportRosterAwareReview`), which is
 * itself built on the slice 2/3/5/6/8 pipeline. Rather than re-running that chain (which
 * would duplicate it), this helper consumes the review's per-row outcomes — derived from
 * the slice 6 commit plan and slice 8 application projection — plus the existing roster
 * team, and assembles a projected roster view. The existing roster (its players, in
 * source order) supplies the "actual" side; the review supplies the imported "projected"
 * side (creates / links / deferred). Link targets are matched authoritatively by the
 * slice 18 row's `linkTargetExistingRecordId` (the slice 6 plan's link target), which
 * uses the same `${teamId}#${index}` record ids this helper reconstructs.
 *
 * Guardrails: STAGING IS PREVIEW ONLY. Nothing is applied, committed, written, linked,
 * created, merged, persisted, or mutated. The review, existing team, its players, the
 * payload, preview rows, and prior seasons are never mutated. Staging is allowed only
 * when the dry run is clean (available, no unresolved/blocked rows — `canCommit`).
 * Deferred rows are a deliberate reviewer outcome: they are listed separately and are
 * NOT added to the projected roster. Raw imported and existing player names are
 * preserved exactly, and existing-roster source order is preserved. Output is identical
 * across repeated calls.
 */

export const UTE_CONFERENCE_SCRAPED_JSON_IMPORT_STAGED_PROJECTION_LOGIC_VERSION =
  'phase5-slice19-scraped-json-import-staged-projection-v1';

export type ScrapedImportStagedUnavailableReason =
  | 'review-unavailable'
  | 'missing-existing-team'
  | 'dry-run-not-clean';

export type ScrapedImportStagedExistingPlayer = {
  /** Raw existing roster player name, preserved exactly. */
  name: string;
  /** True when a confirmed import link maps to this existing player. */
  linked: boolean;
  /** The raw imported name that would link to this player, or null. */
  linkedFromImportedName: string | null;
};

export type ScrapedImportStagedNewPlayer = {
  rowIndex: number;
  /** Raw imported player name, preserved exactly. */
  name: string | null;
};

export type ScrapedImportStagedDeferredRow = {
  rowIndex: number;
  name: string | null;
};

export type ScrapedImportStagedProjection =
  | {
      stageable: false;
      reason: ScrapedImportStagedUnavailableReason;
      message: string;
    }
  | {
      stageable: true;
      existingTeamId: string;
      /** Players currently on the actual roster. */
      actualRosterCount: number;
      /** Imported rows that would be added as new players. */
      stagedNewCount: number;
      /** Imported rows that would link to an existing player (no new roster slot). */
      stagedLinkCount: number;
      /** Imported rows deferred for later review (not added). */
      deferredCount: number;
      /** Projected roster size = actual + new (links do not grow the roster). */
      projectedRosterCount: number;
      /** Existing roster players in source order, annotated with link state. */
      existingPlayers: ScrapedImportStagedExistingPlayer[];
      /** Projected new imported players in imported source order. */
      projectedNewPlayers: ScrapedImportStagedNewPlayer[];
      /** Deferred imported rows in imported source order. */
      deferredRows: ScrapedImportStagedDeferredRow[];
    };

const UNAVAILABLE_MESSAGES: Record<ScrapedImportStagedUnavailableReason, string> = {
  'review-unavailable':
    'Roster-aware review is unavailable, so no projection can be staged.',
  'missing-existing-team':
    'The existing roster team could not be located, so no projection can be staged.',
  'dry-run-not-clean':
    'Resolve every imported row (no unresolved or blocked rows) before staging a projected roster.',
};

function unavailable(
  reason: ScrapedImportStagedUnavailableReason
): ScrapedImportStagedProjection {
  return { stageable: false, reason, message: UNAVAILABLE_MESSAGES[reason] };
}

/**
 * Builds the staged, in-memory projected roster from a clean slice 18 review and the
 * existing roster team. Pure; never mutates the review, team, players, or any input.
 */
export function buildScrapedJsonImportStagedProjection(
  review: ScrapedImportRosterAwareReview,
  existingTeam: Team | null
): ScrapedImportStagedProjection {
  if (!review.available) return unavailable('review-unavailable');
  if (!existingTeam) return unavailable('missing-existing-team');
  if (!review.summary.canCommit) return unavailable('dry-run-not-clean');

  // Existing record ids match slice 18's `${teamId}#${index}` scheme.
  const linkedRecordIds = new Map<string, string | null>();
  for (const row of review.rows) {
    if (row.outcome === 'projected-link' && row.linkTargetExistingRecordId !== null) {
      linkedRecordIds.set(row.linkTargetExistingRecordId, row.playerName);
    }
  }

  const existingPlayers: ScrapedImportStagedExistingPlayer[] = existingTeam.players.map(
    (player, index) => {
      const recordId = `${existingTeam.teamId}#${index}`;
      const linked = linkedRecordIds.has(recordId);
      return {
        name: player.name,
        linked,
        linkedFromImportedName: linked ? linkedRecordIds.get(recordId) ?? null : null,
      };
    }
  );

  const projectedNewPlayers: ScrapedImportStagedNewPlayer[] = review.rows
    .filter((row) => row.outcome === 'projected-create')
    .map((row) => ({
      rowIndex: row.rowIndex,
      name: row.projectedNewPlayerName ?? row.playerName,
    }));

  const deferredRows: ScrapedImportStagedDeferredRow[] = review.rows
    .filter((row) => row.outcome === 'deferred')
    .map((row) => ({ rowIndex: row.rowIndex, name: row.playerName }));

  const stagedLinkCount = review.rows.filter((row) => row.outcome === 'projected-link')
    .length;
  const actualRosterCount = existingTeam.players.length;
  const stagedNewCount = projectedNewPlayers.length;

  return {
    stageable: true,
    existingTeamId: existingTeam.teamId,
    actualRosterCount,
    stagedNewCount,
    stagedLinkCount,
    deferredCount: deferredRows.length,
    projectedRosterCount: actualRosterCount + stagedNewCount,
    existingPlayers,
    projectedNewPlayers,
    deferredRows,
  };
}
