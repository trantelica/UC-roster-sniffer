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
}

const STATUS_LABELS: Record<RosterStatusValue, string> = {
  returning: 'Returning',
  new: 'New',
  unknown: 'Unknown',
  'not-returning': 'Not returning',
};

export default function PlayerCard({ player, status }: PlayerCardProps) {
  return (
    <div className="card">
      <span className="card-name">{player.name}</span>
      {status && (
        <span className={`player-status player-status-${status}`}>
          {STATUS_LABELS[status]}
        </span>
      )}
      {player.notes && <span className="card-notes">{player.notes}</span>}
    </div>
  );
}
