export type AgeDivisionId = 'SC' | 'GR' | 'PW' | 'MM' | 'GI' | 'BA';

export interface ParsedAgeDivision {
  raw: string;
  normalized: string;
  id: AgeDivisionId;
}

/**
 * The fixed age divisions in ascending ordinal order (SC youngest .. BA oldest).
 * This is the single source of truth for both the ordinal lookup and the reverse
 * rank -> id lookup. Age divisions never split or consolidate.
 */
export const AGE_DIVISION_IDS_IN_ORDER: readonly AgeDivisionId[] = [
  'SC',
  'GR',
  'PW',
  'MM',
  'GI',
  'BA',
];

const ORDINALS: Record<AgeDivisionId, number> = AGE_DIVISION_IDS_IN_ORDER.reduce(
  (acc, id, index) => {
    acc[id] = index + 1;
    return acc;
  },
  {} as Record<AgeDivisionId, number>
);

const VALID_IDS = new Set<string>(Object.keys(ORDINALS));

export function parseAgeDivisionId(input: string): ParsedAgeDivision {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error(`Invalid age division: "${input}"`);
  }
  const normalized = input.trim().toUpperCase();
  if (!VALID_IDS.has(normalized)) {
    throw new Error(`Unsupported age division: "${input}"`);
  }
  return { raw: input, normalized, id: normalized as AgeDivisionId };
}

export function getAgeDivisionRank(input: string): number {
  const { id } = parseAgeDivisionId(input);
  return ORDINALS[id];
}

/**
 * Reverse of {@link getAgeDivisionRank}: returns the age-division id for a fixed
 * ordinal rank (SC=1 .. BA=6), or `null` when the rank is out of range. Never
 * throws, so callers stepping along an age-division path stay deterministic.
 */
export function getAgeDivisionIdByRank(rank: number): AgeDivisionId | null {
  if (!Number.isInteger(rank) || rank < 1 || rank > AGE_DIVISION_IDS_IN_ORDER.length) {
    return null;
  }
  return AGE_DIVISION_IDS_IN_ORDER[rank - 1];
}

/**
 * Returns negative if a is younger/lower than b, positive if a is older/higher, 0 if equal.
 */
export function compareAgeDivisions(a: string, b: string): number {
  return getAgeDivisionRank(a) - getAgeDivisionRank(b);
}
