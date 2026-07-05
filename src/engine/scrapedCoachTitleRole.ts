/**
 * PURE, deterministic interpretation of a scraped coach TITLE into a roster-embedded coaching
 * role — ENGINE ONLY.
 *
 * The durable `Team` contract represents coaching staff as a single `headCoach` plus an ordered
 * `assistantCoaches` list. This helper maps the free-text scraped title (e.g. "Head Coach",
 * "Asst Coach") onto that contract. It intentionally recognizes only the small, already-seen
 * label set — head vs assistant — and reports everything else as `unrecognized` so the caller
 * BLOCKS the target rather than guessing (no broad coach-title ontology is invented here).
 *
 * A title that matches BOTH head and assistant signals (e.g. "Assistant Head Coach") is
 * ambiguous and reported `unrecognized` as well. A missing/blank title is `unrecognized`.
 * Purity: never mutates input; deterministic; case/whitespace-insensitive for matching only
 * (the caller keeps the raw title for evidence).
 */

export const SCRAPED_COACH_TITLE_ROLE_LOGIC_VERSION = 'scraped-coach-title-role-v1';

export type ScrapedCoachRole = 'head' | 'assistant' | 'unrecognized';

/** Lowercase, whitespace-collapsed form used ONLY for matching (`\s` also folds NBSP). */
function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Interprets a scraped coach title. Returns `head` for a head-coach label, `assistant` for an
 * assistant/asst label, and `unrecognized` for a missing, blank, ambiguous, or unsupported
 * title. Deterministic and pure.
 */
export function interpretScrapedCoachTitle(title: string | null | undefined): ScrapedCoachRole {
  if (typeof title !== 'string') return 'unrecognized';
  const n = normalizeTitle(title);
  if (n === '') return 'unrecognized';

  const looksHead = /\bhead\b/.test(n);
  const looksAssistant = /\bassistant\b/.test(n) || /\basst\b/.test(n);

  // Ambiguous when both signals are present (e.g. "Assistant Head Coach").
  if (looksHead && looksAssistant) return 'unrecognized';
  if (looksHead) return 'head';
  if (looksAssistant) return 'assistant';
  return 'unrecognized';
}
