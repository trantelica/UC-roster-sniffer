export type AgeDivisionId = 'SC' | 'GR' | 'PW' | 'MM' | 'GI' | 'BA';

export interface ParsedAgeDivision {
  raw: string;
  normalized: string;
  id: AgeDivisionId;
}

const ORDINALS: Record<AgeDivisionId, number> = {
  SC: 1,
  GR: 2,
  PW: 3,
  MM: 4,
  GI: 5,
  BA: 6,
};

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
 * Returns negative if a is younger/lower than b, positive if a is older/higher, 0 if equal.
 */
export function compareAgeDivisions(a: string, b: string): number {
  return getAgeDivisionRank(a) - getAgeDivisionRank(b);
}
