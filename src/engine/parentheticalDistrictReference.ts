/**
 * Parenthetical district routing: PURE, deterministic parse of a scraped TEAM LABEL that
 * carries a trailing parenthetical district reference — ENGINE ONLY.
 *
 * Some scraped roster sources label a team like `GridIron A1 (Layton)`. For UC Roster
 * Sniffer the parenthetical is a REPRESENTED DISTRICT reference, not a team sub-label: the
 * team is `GridIron A1` / `A1` and belongs under the Layton district, while the row's
 * scraped/admin district is retained separately as source evidence.
 *
 * This helper only SPLITS the label; it does not resolve the district candidate against any
 * registry and it never collapses the parenthetical into the team code on its own. Resolution
 * and routing live in the canonical mapping. Matching is exact and structural (a single
 * trailing `(...)` group with no nested parentheses); anything ambiguous returns `null` so the
 * caller keeps the existing non-parenthetical behavior.
 *
 * Purity: the input is never mutated. The original label is preserved EXACTLY.
 */

export const PARENTHETICAL_DISTRICT_REFERENCE_LOGIC_VERSION =
  'parenthetical-district-reference-v1';

export type ParentheticalDistrictReference = {
  /** The original source team label, preserved EXACTLY (e.g. "GridIron A1 (Layton)"). */
  originalLabel: string;
  /** The base team label with the parenthetical removed (e.g. "GridIron A1"). */
  baseLabel: string;
  /** The district candidate text inside the parentheses (e.g. "Layton"). */
  districtCandidate: string;
};

// A single trailing parenthetical group with no nested parentheses, e.g. "Base (Candidate)".
// The base capture is non-greedy with required leading content; the candidate has at least one
// non-paren character. Surrounding/leading whitespace is captured loosely so it can be trimmed.
const TRAILING_PARENTHETICAL = /^(.*\S)\s*\(([^()]+)\)\s*$/;

/**
 * Parses a trailing parenthetical district reference out of a team label. Returns the original
 * label (exact), the base team label, and the district candidate when the label ends in a single
 * `(...)` group with a non-empty base and a non-empty candidate; otherwise returns `null`
 * (no parenthetical, an empty base, an empty candidate, or nested/multiple groups). Pure.
 */
export function parseParentheticalDistrictReference(
  teamLabel: string | null | undefined
): ParentheticalDistrictReference | null {
  if (typeof teamLabel !== 'string') return null;
  const match = teamLabel.match(TRAILING_PARENTHETICAL);
  if (!match) return null;

  const baseLabel = match[1].trim();
  const districtCandidate = match[2].trim();
  if (baseLabel === '' || districtCandidate === '') return null;

  return { originalLabel: teamLabel, baseLabel, districtCandidate };
}
