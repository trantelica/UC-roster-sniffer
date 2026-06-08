import type { Team } from '../domain/types';

export function countPlayers(team: Team): number {
  return team.players.length;
}

export function countHeadCoaches(team: Team): number {
  return team.headCoach !== null ? 1 : 0;
}

export function countAssistantCoaches(team: Team): number {
  return team.assistantCoaches.length;
}
