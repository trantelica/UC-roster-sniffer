import { describe, it, expect } from 'vitest';
import {
  createRosterImportPreviewIdentityMatches,
  summarizeRosterImportPreviewIdentityMatches,
  getRosterImportPreviewIdentityMatchesNeedingReview,
  getRosterImportPreviewIdentityMatchesReadyForApply,
} from '../engine/rosterImportPreviewIdentityMatch';
import type { ExistingRosterIdentityRecord } from '../engine/rosterImportPreviewIdentityMatch';
import type {
  RosterImportPreviewRow,
  RosterImportPreviewRowStatus,
} from '../engine/rosterImportPreview';
import { getPlayerIdentityKey } from '../engine/playerIdentity';

// ---------------------------------------------------------------------------
// Helpers — build preview rows directly so we can exercise statuses (including
// `ready` rows that share an identity key, which the slice-1 builder would mark
// `needs-review`).
// ---------------------------------------------------------------------------

function previewRow(
  rowIndex: number,
  sourceRowId: string | null,
  playerName: string | null,
  status: RosterImportPreviewRowStatus,
  jerseyNumber: string | null = null
): RosterImportPreviewRow {
  return {
    sourceRowId,
    rowIndex,
    playerName,
    normalizedIdentityKey:
      playerName === null ? null : getPlayerIdentityKey(playerName),
    fields: { jerseyNumber, grade: null, notes: null, raw: null },
    issues: [],
    status,
  };
}

function readyRow(
  rowIndex: number,
  sourceRowId: string,
  playerName: string,
  jerseyNumber: string | null = null
): RosterImportPreviewRow {
  return previewRow(rowIndex, sourceRowId, playerName, 'ready', jerseyNumber);
}

function existing(
  recordId: string,
  playerName: string | undefined,
  extra: Partial<ExistingRosterIdentityRecord> = {}
): ExistingRosterIdentityRecord {
  return { recordId, playerName, ...extra };
}

// ---------------------------------------------------------------------------
// 1. Empty preview rows -> deterministic empty result
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - empty', () => {
  it('returns a deterministic empty result', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [],
      existingRosterRecords: [existing('e1', 'Jordan Smith')],
    });
    expect(result.entries).toEqual([]);
    expect(result.issues).toEqual([]);
    expect(result.summary).toEqual({
      totalEntries: 0,
      noMatchEntries: 0,
      singleCandidateEntries: 0,
      multipleCandidateEntries: 0,
      skippedInvalidEntries: 0,
      skippedReviewEntries: 0,
      readyForApplyEntries: 0,
      needsReviewEntries: 0,
      totalCandidates: 0,
    });
  });

  it('treats missing arrays as empty without throwing', () => {
    const result = createRosterImportPreviewIdentityMatches({});
    expect(result.entries).toEqual([]);
    expect(result.summary.totalEntries).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Empty existing records -> no-match entries for ready rows
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - no existing records', () => {
  it('produces no-match entries for ready rows', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith')],
      existingRosterRecords: [],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].status).toBe('no-match');
    expect(result.entries[0].candidates).toEqual([]);
    expect(
      result.entries[0].issues.some(
        (i) => i.code === 'no-existing-identity-match'
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. Invalid preview rows -> skipped-invalid-preview-row
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - invalid preview rows', () => {
  it('preserves invalid rows as skipped-invalid-preview-row', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [previewRow(0, null, null, 'invalid')],
      existingRosterRecords: [existing('e1', 'Jordan Smith')],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].status).toBe('skipped-invalid-preview-row');
    expect(result.entries[0].candidates).toEqual([]);
    expect(
      result.entries[0].issues.some((i) => i.code === 'preview-row-invalid')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. needs-review preview rows -> skipped-review-preview-row
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - needs-review preview rows', () => {
  it('preserves needs-review rows as skipped-review-preview-row', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [previewRow(0, 'r1', 'Jordan Smith', 'needs-review')],
      existingRosterRecords: [existing('e1', 'Jordan Smith')],
    });
    expect(result.entries[0].status).toBe('skipped-review-preview-row');
    expect(result.entries[0].candidates).toEqual([]);
    expect(
      result.entries[0].issues.some(
        (i) => i.code === 'preview-row-needs-review'
      )
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Exact identity-key match -> single candidate
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - single candidate', () => {
  it('creates one high-confidence candidate for an exact key match', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith')],
      existingRosterRecords: [existing('e1', 'jordan  smith')],
    });
    const entry = result.entries[0];
    expect(entry.status).toBe('single-candidate');
    expect(entry.candidates).toHaveLength(1);
    expect(entry.candidates[0].existingRecordId).toBe('e1');
    expect(entry.candidates[0].matchType).toBe('exact-identity-key');
    expect(entry.candidates[0].confidence).toBe('high');
    expect(entry.candidates[0].reasons).toEqual(['exact-normalized-name-match']);
  });
});

// ---------------------------------------------------------------------------
// 6. No identity-key match -> no-match
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - no match', () => {
  it('marks a ready row with no key match as no-match', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith')],
      existingRosterRecords: [existing('e1', 'Someone Else')],
    });
    expect(result.entries[0].status).toBe('no-match');
    expect(result.entries[0].candidates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. Multiple existing records, same key -> multiple-candidates
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - multiple candidates', () => {
  it('creates multiple-candidates requiring review', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith')],
      existingRosterRecords: [
        existing('e1', 'Jordan Smith'),
        existing('e2', 'Jordan Smith'),
      ],
    });
    const entry = result.entries[0];
    expect(entry.status).toBe('multiple-candidates');
    expect(entry.candidates).toHaveLength(2);
    expect(
      entry.candidates.every(
        (c) => c.matchType === 'same-name-duplicate-existing'
      )
    ).toBe(true);
    expect(
      getRosterImportPreviewIdentityMatchesNeedingReview(result)
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 8. Duplicate preview identity keys -> review metadata, entries preserved
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - duplicate preview keys', () => {
  it('flags both ready rows for review without discarding entries', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [
        readyRow(0, 'r1', 'Jordan Smith'),
        readyRow(1, 'r2', 'jordan smith'),
      ],
      existingRosterRecords: [existing('e1', 'Jordan Smith')],
    });
    expect(result.entries).toHaveLength(2);
    for (const entry of result.entries) {
      expect(entry.status).toBe('single-candidate');
      expect(entry.candidates[0].matchType).toBe('same-name-duplicate-preview');
      expect(entry.candidates[0].reasons).toContain('preview-duplicate-name');
      expect(entry.issues.some((i) => i.code === 'preview-duplicate-name')).toBe(
        true
      );
    }
    expect(
      getRosterImportPreviewIdentityMatchesReadyForApply(result)
    ).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9. Duplicate existing identity keys -> review metadata, candidates preserved
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - duplicate existing keys', () => {
  it('keeps all candidates and adds existing-duplicate-name reasons', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith')],
      existingRosterRecords: [
        existing('e1', 'Jordan Smith'),
        existing('e2', 'Jordan Smith'),
      ],
    });
    const entry = result.entries[0];
    expect(entry.candidates).toHaveLength(2);
    expect(
      entry.candidates.every((c) =>
        c.reasons.includes('existing-duplicate-name')
      )
    ).toBe(true);
    expect(entry.candidates.every((c) => c.confidence === 'low')).toBe(true);
    expect(
      entry.issues.some((i) => i.code === 'existing-duplicate-name')
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10. Matching jersey number adds a reason to an exact-name candidate
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - jersey assist', () => {
  it('adds matching-jersey-number and uses jersey-assisted-exact-name', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith', '7')],
      existingRosterRecords: [
        existing('e1', 'Jordan Smith', { jerseyNumber: '7' }),
      ],
    });
    const candidate = result.entries[0].candidates[0];
    expect(candidate.reasons).toContain('matching-jersey-number');
    expect(candidate.matchType).toBe('jersey-assisted-exact-name');
    expect(candidate.confidence).toBe('high');
  });

  it('raises confidence within an ambiguous existing-duplicate group', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith', '7')],
      existingRosterRecords: [
        existing('e1', 'Jordan Smith', { jerseyNumber: '7' }),
        existing('e2', 'Jordan Smith', { jerseyNumber: '9' }),
      ],
    });
    const [c1, c2] = result.entries[0].candidates;
    // both stay flagged as duplicate-existing, but the jersey match lifts e1
    expect(c1.matchType).toBe('same-name-duplicate-existing');
    expect(c1.confidence).toBe('medium');
    expect(c1.reasons).toContain('matching-jersey-number');
    expect(c2.confidence).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// 11. Jersey number alone does not create a match
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - jersey alone', () => {
  it('does not match different names that share a jersey number', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Alice One', '7')],
      existingRosterRecords: [existing('e1', 'Bob Two', { jerseyNumber: '7' })],
    });
    expect(result.entries[0].status).toBe('no-match');
    expect(result.entries[0].candidates).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 12. Missing existing record name does not throw and is reported
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - invalid existing record', () => {
  it('reports an invalid existing record without throwing', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith')],
      existingRosterRecords: [
        existing('e-bad', undefined),
        existing('e-blank', '   '),
        existing('e1', 'Jordan Smith'),
      ],
    });
    expect(result.issues.filter((i) => i.code === 'invalid-existing-record'))
      .toHaveLength(2);
    // valid record still matches; invalid ones are excluded from matching only
    expect(result.entries[0].status).toBe('single-candidate');
    expect(result.entries[0].candidates[0].existingRecordId).toBe('e1');
  });
});

// ---------------------------------------------------------------------------
// 13. Candidate ordering follows existing roster record input order
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - candidate order', () => {
  it('orders candidates by existing-record input order', () => {
    const forward = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith')],
      existingRosterRecords: [
        existing('e1', 'Jordan Smith'),
        existing('e2', 'Jordan Smith'),
      ],
    });
    expect(forward.entries[0].candidates.map((c) => c.existingRecordId)).toEqual(
      ['e1', 'e2']
    );

    const reversed = createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith')],
      existingRosterRecords: [
        existing('e2', 'Jordan Smith'),
        existing('e1', 'Jordan Smith'),
      ],
    });
    expect(
      reversed.entries[0].candidates.map((c) => c.existingRecordId)
    ).toEqual(['e2', 'e1']);
  });
});

// ---------------------------------------------------------------------------
// 14. Entry ordering follows preview row order
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - entry order', () => {
  it('preserves preview row order in entries', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [
        readyRow(0, 'r3', 'Charlie Third'),
        readyRow(1, 'r1', 'Alice First'),
        readyRow(2, 'r2', 'Bob Second'),
      ],
      existingRosterRecords: [],
    });
    expect(result.entries.map((e) => e.previewSourceRowId)).toEqual([
      'r3',
      'r1',
      'r2',
    ]);
    expect(result.entries.map((e) => e.previewRowIndex)).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// 15-17. ready-for-apply helper
// ---------------------------------------------------------------------------

describe('getRosterImportPreviewIdentityMatchesReadyForApply', () => {
  const result = createRosterImportPreviewIdentityMatches({
    previewRows: [
      readyRow(0, 'clean', 'Clean Match'), // single high -> apply ready
      readyRow(1, 'nomatch', 'No One'), // no-match
      readyRow(2, 'multi', 'Dup Existing'), // multiple-candidates
    ],
    existingRosterRecords: [
      existing('e1', 'Clean Match'),
      existing('e2', 'Dup Existing'),
      existing('e3', 'Dup Existing'),
    ],
  });

  it('15. returns only safe single high-confidence entries', () => {
    const ready = getRosterImportPreviewIdentityMatchesReadyForApply(result);
    expect(ready).toHaveLength(1);
    expect(ready[0].previewSourceRowId).toBe('clean');
  });

  it('16. excludes no-match entries', () => {
    const ready = getRosterImportPreviewIdentityMatchesReadyForApply(result);
    expect(ready.some((e) => e.status === 'no-match')).toBe(false);
  });

  it('17. excludes multiple-candidate entries', () => {
    const ready = getRosterImportPreviewIdentityMatchesReadyForApply(result);
    expect(ready.some((e) => e.status === 'multiple-candidates')).toBe(false);
  });

  it('accepts a bare entries array too', () => {
    expect(
      getRosterImportPreviewIdentityMatchesReadyForApply(result.entries)
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 18-19. Inputs are not mutated
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - purity', () => {
  it('does not mutate input preview rows', () => {
    const rows = [readyRow(0, 'r1', 'Jordan Smith', '7')];
    const snapshot = JSON.parse(JSON.stringify(rows));
    createRosterImportPreviewIdentityMatches({
      previewRows: rows,
      existingRosterRecords: [existing('e1', 'Jordan Smith')],
    });
    expect(JSON.parse(JSON.stringify(rows))).toEqual(snapshot);
  });

  it('does not mutate input existing roster records', () => {
    const records = [
      existing('e1', 'Jordan Smith', { jerseyNumber: '7', raw: { src: 'x' } }),
      existing('e2', 'Jordan Smith'),
    ];
    const snapshot = JSON.parse(JSON.stringify(records));
    createRosterImportPreviewIdentityMatches({
      previewRows: [readyRow(0, 'r1', 'Jordan Smith', '7')],
      existingRosterRecords: records,
    });
    expect(JSON.parse(JSON.stringify(records))).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------
// 20. Deterministic output across repeated calls
// ---------------------------------------------------------------------------

describe('createRosterImportPreviewIdentityMatches - determinism', () => {
  it('produces identical output across repeated calls', () => {
    const input = {
      previewRows: [
        readyRow(0, 'r1', 'Jordan Smith', '7'),
        readyRow(1, 'r2', 'jordan smith'),
        previewRow(2, 'r3', null, 'invalid'),
        readyRow(3, 'r4', 'Unique Person'),
      ],
      existingRosterRecords: [
        existing('e1', 'Jordan Smith', { jerseyNumber: '7' }),
        existing('e2', 'Jordan Smith'),
        existing('e-bad', undefined),
      ],
    };
    const a = createRosterImportPreviewIdentityMatches(input);
    const b = createRosterImportPreviewIdentityMatches(input);
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// Summary helper consistency
// ---------------------------------------------------------------------------

describe('summarizeRosterImportPreviewIdentityMatches', () => {
  it('tallies entries consistently with createRosterImportPreviewIdentityMatches', () => {
    const result = createRosterImportPreviewIdentityMatches({
      previewRows: [
        readyRow(0, 'clean', 'Clean Match'),
        readyRow(1, 'nomatch', 'No One'),
        readyRow(2, 'multi', 'Dup Existing'),
        previewRow(3, 'inv', null, 'invalid'),
        previewRow(4, 'rev', 'Needs Review', 'needs-review'),
      ],
      existingRosterRecords: [
        existing('e1', 'Clean Match'),
        existing('e2', 'Dup Existing'),
        existing('e3', 'Dup Existing'),
      ],
    });
    expect(result.summary).toEqual(
      summarizeRosterImportPreviewIdentityMatches(result.entries)
    );
    expect(result.summary.totalEntries).toBe(5);
    expect(result.summary.singleCandidateEntries).toBe(1);
    expect(result.summary.noMatchEntries).toBe(1);
    expect(result.summary.multipleCandidateEntries).toBe(1);
    expect(result.summary.skippedInvalidEntries).toBe(1);
    expect(result.summary.skippedReviewEntries).toBe(1);
    expect(result.summary.readyForApplyEntries).toBe(1);
    expect(result.summary.needsReviewEntries).toBe(1);
    expect(result.summary.totalCandidates).toBe(3);
  });
});
