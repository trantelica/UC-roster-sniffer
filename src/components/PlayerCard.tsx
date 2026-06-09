import type { Player } from '../domain/types';
import type { RosterStatusValue } from '../engine/rosterStatus';

interface PlayerCardProps {
  player: Player;
  /**
   * Derived roster status for this current-roster player, when prior-season
   * comparison is available. A current card only ever shows returning, new, or
   * unknown; not-returning is a summary-only status and is never passed here.
   */
  status?: RosterStatusValue;
  /**
   * Distinct identity-review signal, separate from the roster status badge.
   * When true, the card shows a low-confidence warning indicating the derived
   * identity match needs review. This is display metadata only; it never alters
   * or hides the player record. PlayerCard does not compute this — it is decided
   * upstream from already-derived status confidence.
   */
  lowConfidence?: boolean;
}

const STATUS_LABELS: Record<RosterStatusValue, string> = {
  returning: 'Returning',
  new: 'New',
  unknown: 'Unknown',
  'not-returning': 'Not returning',
};

export default function PlayerCard({ player, status, lowConfidence }: PlayerCardProps) {
  return (
    <div className="card">
      <span className="card-name">{player.name}</span>
      {status && (
        <span className={`player-status player-status-${status}`}>
          {STATUS_LABELS[status]}
        </span>
      )}
      {lowConfidence && (
        <span className="player-identity-warning">Identity review</span>
      )}
      {player.notes && <span className="card-notes">{player.notes}</span>}
    </div>
  );
}
