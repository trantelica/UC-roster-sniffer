import { describe, it, expect } from 'vitest';
import { parseScrapedJsonImportFileText } from '../app/scrapedImportFileParse';

describe('parseScrapedJsonImportFileText', () => {
  it('parses valid JSON into a payload', () => {
    const result = parseScrapedJsonImportFileText('{"metadata":{"record_type":"players"}}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.payload as { metadata: { record_type: string } }).metadata.record_type).toBe(
        'players'
      );
    }
  });

  it('reports invalid JSON cleanly without throwing', () => {
    const result = parseScrapedJsonImportFileText('{ not valid json ');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-json');
      expect(result.message).toMatch(/not valid json/i);
    }
  });

  it('reports an empty file distinctly', () => {
    const result = parseScrapedJsonImportFileText('   \n  ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('empty-file');
  });

  it('is deterministic and does not mutate input semantics', () => {
    const text = '{"a":1,"b":[2,3]}';
    expect(parseScrapedJsonImportFileText(text)).toEqual(parseScrapedJsonImportFileText(text));
  });
});
