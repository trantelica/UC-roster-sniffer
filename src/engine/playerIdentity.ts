export type ParsedPlayerName = {
  raw: string;
  normalized: string;
  identityKey: string;
};

function assertNonEmpty(input: string): void {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error(`Invalid player name: "${input}"`);
  }
}

function toTitleCase(word: string): string {
  if (word.length === 0) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * Returns a clean, deterministic display form of the player name.
 * Trims whitespace, collapses internal spaces, title-cases each word,
 * removes periods, and converts commas to spaces.
 * Apostrophes and hyphens are preserved.
 */
export function normalizePlayerName(input: string): string {
  assertNonEmpty(input);
  return input
    .replace(/,/g, ' ')
    .replace(/\./g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(toTitleCase)
    .join(' ');
}

/**
 * Returns a stable lowercase key suitable for deterministic name comparison.
 * Derived from the normalized form; apostrophes are removed.
 * Does not perform fuzzy matching, nickname inference, or confidence scoring.
 */
export function getPlayerIdentityKey(input: string): string {
  const normalized = normalizePlayerName(input);
  return normalized
    .toLowerCase()
    .replace(/'/g, '');
}

/**
 * Parses a raw player name string into its raw, normalized, and identity-key forms.
 */
export function parsePlayerName(input: string): ParsedPlayerName {
  assertNonEmpty(input);
  return {
    raw: input,
    normalized: normalizePlayerName(input),
    identityKey: getPlayerIdentityKey(input),
  };
}
