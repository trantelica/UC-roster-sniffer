import type { Player } from '../domain/types';

interface PlayerCardProps {
  player: Player;
}

export default function PlayerCard({ player }: PlayerCardProps) {
  return (
    <div className="card">
      <span className="card-name">{player.name}</span>
      {player.notes && <span className="card-notes">{player.notes}</span>}
    </div>
  );
}
