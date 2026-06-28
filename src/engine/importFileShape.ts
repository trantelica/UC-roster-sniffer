import { detectUteConferenceScrapedJsonRecordType } from './uteConferenceScrapedJsonAdapter';
import { WORKSPACE_SNAPSHOT_APP, WORKSPACE_SNAPSHOT_KIND } from './workspaceSnapshot';

/**
 * Completion Milestone E2: PURE, deterministic coarse classification of an already-parsed
 * import payload — ENGINE ONLY.
 *
 * It answers one question for the file-error guidance: "what KIND of file is this?" so the
 * two import paths (portable Dataset Import vs scraped Roster import) can tell the user when a
 * file belongs in the OTHER path. It does not validate deeply, never mutates the payload, and
 * is never used to auto-route a file — only to explain a mismatch in plain language.
 */

export type ImportFileShape =
  | 'dataset-snapshot' // a UC Roster Sniffer portable dataset export
  | 'scraped-players' // a scraped Ute Conference players file
  | 'scraped-coaches' // a scraped Ute Conference coaches file
  | 'scraped-unknown' // looks scraped (metadata/districts present) but unsupported record_type
  | 'unknown'; // none of the above

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Classifies a parsed payload's coarse shape. A dataset snapshot is recognised by its
 * `snapshotKind`/`appName` marker or a `workspace` object with a `schemaVersion`; a scraped
 * file by its record type (players/coaches) or, failing that, by carrying scraped-looking
 * `metadata`/`districts`. Pure; never mutates the input.
 */
export function classifyImportFileShape(payload: unknown): ImportFileShape {
  if (!isObject(payload)) return 'unknown';

  if (
    payload.snapshotKind === WORKSPACE_SNAPSHOT_KIND ||
    payload.appName === WORKSPACE_SNAPSHOT_APP ||
    (isObject(payload.workspace) && payload.schemaVersion !== undefined)
  ) {
    return 'dataset-snapshot';
  }

  const recordType = detectUteConferenceScrapedJsonRecordType(payload);
  if (recordType === 'players') return 'scraped-players';
  if (recordType === 'coaches') return 'scraped-coaches';

  if (isObject(payload.metadata) || Array.isArray(payload.districts)) {
    return 'scraped-unknown';
  }
  return 'unknown';
}
