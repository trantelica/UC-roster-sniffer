export type SeasonEditStatus = 'editable' | 'locked';

function normalizeSeasonId(input: string, label: string): string {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error(`Invalid ${label}: "${input}"`);
  }
  return input.trim();
}

export function isSeasonLocked(seasonId: string, activeSeasonId: string): boolean {
  const id = normalizeSeasonId(seasonId, 'seasonId');
  const activeId = normalizeSeasonId(activeSeasonId, 'activeSeasonId');
  return id !== activeId;
}

export function getSeasonEditStatus(seasonId: string, activeSeasonId: string): SeasonEditStatus {
  return isSeasonLocked(seasonId, activeSeasonId) ? 'locked' : 'editable';
}

export function assertSeasonEditable(seasonId: string, activeSeasonId: string): void {
  const status = getSeasonEditStatus(seasonId, activeSeasonId);
  if (status !== 'editable') {
    throw new Error(
      `Season "${seasonId.trim()}" is locked. Only the active season "${activeSeasonId.trim()}" is editable.`
    );
  }
}
