import { WORKSPACE_SNAPSHOT_APP, WORKSPACE_SNAPSHOT_KIND } from './workspaceSnapshot';

/**
 * Production-blocker correction: PURE, deterministic classification of a parsed scraped
 * import SOURCE payload — ENGINE ONLY.
 *
 * Claude-generated scrape output can drift between two supported modes: the existing NESTED
 * scraped payload (`metadata` + `districts[].teams[]`) and a FLAT row-list (one object per
 * player/coach row). This classifier names the shape so the normalizer can convert a flat
 * row-list into the nested shape the existing import session already understands — without a
 * parallel import system. It never mutates the payload and makes no judgement beyond shape.
 */

export type UteImportSourceShape =
  | 'nested-players' // existing nested scraped players payload
  | 'nested-coaches' // existing nested scraped coaches payload
  | 'flat-players' // a flat row-list whose rows are valid player rows
  | 'flat-coaches' // a flat row-list whose rows are valid coach rows
  | 'flat-unsupported' // an array, but the rows are missing required keys
  | 'empty-source' // an empty array (no rows to import)
  | 'dataset' // a UC Roster Sniffer dataset export (belongs in Import Dataset)
  | 'unknown'; // none of the above

/** Row key aliases (exact, deterministic — never fuzzy). */
export const DISTRICT_KEYS = ['district', 'district_name'] as const;
export const AGE_KEYS = ['age_group', 'ageDivision', 'age_division', 'league'] as const;
export const TEAM_KEYS = ['team', 'team_name'] as const;
export const PLAYER_NAME_KEYS = ['player_name', 'player', 'name'] as const;
export const COACH_NAME_KEYS = ['coach_name', 'coach', 'name'] as const;
export const COACH_TITLE_KEYS = ['coach_title', 'title'] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** First present non-blank string among the given keys, else null. Never trims the value. */
export function readAliasString(
  row: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

/** True when a key among `keys` is present at all (even if blank). */
function hasAnyKey(row: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => key in row);
}

function isDatasetExport(payload: Record<string, unknown>): boolean {
  return (
    payload.snapshotKind === WORKSPACE_SNAPSHOT_KIND ||
    payload.appName === WORKSPACE_SNAPSHOT_APP ||
    (isObject(payload.workspace) && payload.schemaVersion !== undefined)
  );
}

/** A flat row counts as a valid PLAYER row when district + age + team + name all resolve. */
export function isValidFlatPlayerRow(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  return (
    readAliasString(value, DISTRICT_KEYS) !== null &&
    readAliasString(value, AGE_KEYS) !== null &&
    readAliasString(value, TEAM_KEYS) !== null &&
    readAliasString(value, PLAYER_NAME_KEYS) !== null
  );
}

/** A flat row counts as a valid COACH row when district + age + team + coach name resolve. */
export function isValidFlatCoachRow(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  return (
    readAliasString(value, DISTRICT_KEYS) !== null &&
    readAliasString(value, AGE_KEYS) !== null &&
    readAliasString(value, TEAM_KEYS) !== null &&
    readAliasString(value, COACH_NAME_KEYS) !== null
  );
}

/** True when any row carries an explicit coach signal (title / coach_name / coach). */
function looksLikeCoachRows(rows: unknown[]): boolean {
  const anyPlayerName = rows.some(
    (r) => isObject(r) && (('player_name' in r) || ('player' in r))
  );
  if (anyPlayerName) return false;
  return rows.some(
    (r) =>
      isObject(r) &&
      (hasAnyKey(r, COACH_TITLE_KEYS) || ('coach_name' in r) || ('coach' in r))
  );
}

/**
 * Classifies a parsed import source payload. Pure; never mutates the payload. A flat
 * row-list is read as coaches only when it carries explicit coach signals and no player-name
 * key; otherwise a flat row-list is treated as players (the primary path).
 */
export function classifyUteConferenceImportSource(payload: unknown): UteImportSourceShape {
  if (Array.isArray(payload)) {
    if (payload.length === 0) return 'empty-source';
    if (looksLikeCoachRows(payload)) {
      return payload.every(isValidFlatCoachRow) ? 'flat-coaches' : 'flat-unsupported';
    }
    return payload.every(isValidFlatPlayerRow) ? 'flat-players' : 'flat-unsupported';
  }

  if (!isObject(payload)) return 'unknown';
  if (payload.record_type === undefined && isDatasetExport(payload)) return 'dataset';
  if (isObject(payload.metadata)) {
    const recordType = (payload.metadata as Record<string, unknown>).record_type;
    if (recordType === 'players') return 'nested-players';
    if (recordType === 'coaches') return 'nested-coaches';
  }
  if (isDatasetExport(payload)) return 'dataset';
  return 'unknown';
}
