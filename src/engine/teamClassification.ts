export type TeamClassificationCode = 'B1' | 'C1' | 'B2' | 'B3_PLUS' | 'C2' | 'D2';

export interface ParsedTeamClassification {
  raw: string;
  normalized: string;
  code: TeamClassificationCode;
}

const RANK: Record<TeamClassificationCode, number> = {
  B1: 400,
  C1: 300,
  B2: 200,
  B3_PLUS: 100,
  C2: 100,
  D2: 100,
};

const SUPPORTED_EXACT: Record<string, TeamClassificationCode> = {
  B1: 'B1',
  C1: 'C1',
  B2: 'B2',
  C2: 'C2',
  D2: 'D2',
};

function normalizeInput(input: string): string {
  return input.trim().toUpperCase();
}

function resolveCode(normalized: string): TeamClassificationCode | null {
  if (normalized in SUPPORTED_EXACT) {
    return SUPPORTED_EXACT[normalized];
  }
  // B3, B4, B5, ... -> B3_PLUS
  if (/^B([3-9]|\d{2,})$/.test(normalized)) {
    return 'B3_PLUS';
  }
  return null;
}

export function parseTeamClassification(input: string): ParsedTeamClassification {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error(`Invalid team classification: "${input}"`);
  }
  const normalized = normalizeInput(input);
  const code = resolveCode(normalized);
  if (code === null) {
    throw new Error(`Unsupported team classification: "${input}"`);
  }
  return { raw: input, normalized, code };
}

export function getTeamClassificationRank(input: string): number {
  const { code } = parseTeamClassification(input);
  return RANK[code];
}

/**
 * Returns negative if a is stronger, positive if b is stronger, 0 if equivalent.
 */
export function compareTeamClassifications(a: string, b: string): number {
  return getTeamClassificationRank(b) - getTeamClassificationRank(a);
}
