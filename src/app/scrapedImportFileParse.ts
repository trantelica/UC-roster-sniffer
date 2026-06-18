/**
 * Phase 5 slice 17: PURE parsing of a locally-selected scraped JSON import file.
 *
 * React reads the file's text with the browser FileReader (local only — no upload, no
 * backend, no storage); this helper turns that text into a parsed payload or a clean
 * invalid-file error. It is intentionally tiny and pure so the invalid-JSON path can be
 * unit-tested without a DOM. It does NOT validate scraped structure — that is the import
 * session engine's job (an unsupported-but-valid-JSON payload becomes an
 * `invalid-source` session downstream). The parsed payload is returned as-is and is
 * never mutated.
 */

export type ScrapedImportFileParseResult =
  | { ok: true; payload: unknown }
  | { ok: false; reason: 'empty-file' | 'invalid-json'; message: string };

/** Parses scraped JSON file text. Never throws; returns a result either way. */
export function parseScrapedJsonImportFileText(
  text: string
): ScrapedImportFileParseResult {
  if (text.trim() === '') {
    return {
      ok: false,
      reason: 'empty-file',
      message: 'The selected file is empty.',
    };
  }
  try {
    const payload = JSON.parse(text) as unknown;
    return { ok: true, payload };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Unknown parse error';
    return {
      ok: false,
      reason: 'invalid-json',
      message: `The selected file is not valid JSON: ${detail}`,
    };
  }
}
