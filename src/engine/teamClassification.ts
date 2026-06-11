export type TeamClassificationCode =
  | 'A'
  | 'B1'
  | 'C1'
  | 'B2'
  | 'B3_PLUS'
  | 'C2'
  | 'D2';

export interface ParsedTeamClassification {
  raw: string;
  normalized: string;
  code: TeamClassificationCode;
}

// Competitive hierarchy: A(x) > B1 > C1 = B2 > B3+ = C2 = D2.
// Any valid A-code (A1..A4) is the top tier and A-codes are hierarchy-equivalent.
// C1 and B2 are equivalent; B3+, C2, and D2 are equivalent.
const RANK: Record<TeamClassificationCode, number> = {
  A: 500,
  B1: 400,
  C1: 300,
  B2: 300,
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
  // A1, A2, A3, A4 -> A (top tier; A-team designation caps at A4). All A-codes
  // are treated as a single hierarchy-equivalent tier.
  if (/^A[1-4]$/.test(normalized)) {
    return 'A';
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
