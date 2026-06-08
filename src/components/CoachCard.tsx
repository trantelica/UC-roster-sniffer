import type { Coach } from '../domain/types';

interface CoachCardProps {
  coach: Coach;
  role: 'headCoach' | 'assistantCoach';
}

const roleLabel: Record<CoachCardProps['role'], string> = {
  headCoach: 'Head Coach',
  assistantCoach: 'Assistant Coach',
};

export default function CoachCard({ coach, role }: CoachCardProps) {
  return (
    <div className="card">
      <span className="card-label">{roleLabel[role]}</span>
      <span className="card-name">{coach.name}</span>
    </div>
  );
}
