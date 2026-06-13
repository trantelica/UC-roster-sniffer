import { describe, it, expect } from 'vitest';
import {
  createRosterImportPreview,
  summarizeRosterImportPreviewRows,
  getRosterImportPreviewRowsNeedingReview,
  getValidRosterImportPreviewRows,
} from '../engine/rosterImportPreview';
import type {
  RosterImportPreviewInput,
  RosterImportPreviewRowInput,
} from '../engine/rosterImportPreview';
import { getPlayerIdentityKey } from '../engine/playerIdentity';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TARGET = {
  seasonId: '2026',
  districtId: 'alta',
  ageDivisionId: 'GI',
  teamId: 'alta-GI-A1',
};

function withRows(
  rows: RosterImportPreviewRowInput[]
): RosterImportPreviewInput {
  return { ...TARGET, rows };
}

function row(
  sourceRowId: string | undefined,
  playerName: string | undefined,
  extra: Partial<RosterImportPreviewRowInput> = {}
): RosterImportPreviewRowInput {
  return { sourceRowId, playerName, ...extra };
}

// ---------------------------------------------------------------------------
// 1. Empty import rows -> deterministic preview summary
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - empty', () => {
  it('returns a deterministic empty preview summary', () => {
    const result = createRosterImportPreview(withRows([]));
    expect(result.rows).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({
      totalRows: 0,
      readyRows: 0,
      needsReviewRows: 0,
      invalidRows: 0,
      duplicateNameGroups: 0,
      duplicateSourceRowIdGroups: 0,
      errorCount: 0,
      warningCount: 0,
      infoCount: 0,
    });
  });

  it('treats missing rows array as empty', () => {
    const result = createRosterImportPreview({ ...TARGET });
    expect(result.rows).toEqual([]);
    expect(result.summary.totalRows).toBe(0);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Valid rows -> ready preview rows
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - valid rows', () => {
  it('produces ready rows for valid input', () => {
    const result = createRosterImportPreview(
      withRows([
        row('r1', 'Cary, Hudson'),
        row('r2', 'Jordan Smith'),
      ])
    );
    expect(result.ok).toBe(true);
    expect(result.rows.map((r) => r.status)).toEqual(['ready', 'ready']);
    expect(result.rows.every((r) => r.issues.length === 0)).toBe(true);
    expect(result.summary.readyRows).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 3. Row order is preserved
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - order', () => {
  it('preserves input row order', () => {
    const result = createRosterImportPreview(
      withRows([
        row('r3', 'Charlie Third'),
        row('r1', 'Alice First'),
        row('r2', 'Bob Second'),
      ])
    );
    expect(result.rows.map((r) => r.sourceRowId)).toEqual(['r3', 'r1', 'r2']);
    expect(result.rows.map((r) => r.playerName)).toEqual([
      'Charlie Third',
      'Alice First',
      'Bob Second',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 4. rowIndex is deterministic
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - rowIndex', () => {
  it('assigns rowIndex from input order', () => {
    const result = createRosterImportPreview(
      withRows([row('r1', 'A A'), row('r2', 'B B'), row('r3', 'C C')])
    );
    expect(result.rows.map((r) => r.rowIndex)).toEqual([0, 1, 2]);
  });
});

// ---------------------------------------------------------------------------
// 5. Identity key uses the existing Phase 2 helper
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - identity key', () => {
  it('derives normalizedIdentityKey via getPlayerIdentityKey', () => {
    const result = createRosterImportPreview(
      withRows([row('r1', "O'Brien, Sean")])
    );
    expect(result.rows[0].normalizedIdentityKey).toBe(
      getPlayerIdentityKey("O'Brien, Sean")
    );
  });
});

// ---------------------------------------------------------------------------
// 6. Missing player name -> preserved + invalid
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - missing player name', () => {
  it('preserves the row and marks it invalid', () => {
    const result = createRosterImportPreview(
      withRows([row('r1', undefined), row('r2', '   ')])
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.status)).toEqual(['invalid', 'invalid']);
    expect(result.rows[0].normalizedIdentityKey).toBeNull();
    expect(
      result.rows[0].issues.some((i) => i.code === 'missing-player-name')
    ).toBe(true);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Duplicate names within import -> all preserved + needs-review
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - duplicate names', () => {
  it('preserves all rows and marks the group needs-review', () => {
    const result = createRosterImportPreview(
      withRows([
        row('r1', 'Jordan Smith'),
        row('r2', 'jordan  smith'),
        row('r3', 'Unique Name'),
      ])
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.status)).toEqual([
      'needs-review',
      'needs-review',
      'ready',
    ]);
    expect(
      result.rows
        .slice(0, 2)
        .every((r) =>
          r.issues.some((i) => i.code === 'duplicate-name-in-import')
        )
    ).toBe(true);
    expect(result.summary.duplicateNameGroups).toBe(1);
    // duplicates are review items, not errors -> ok stays true
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. Duplicate sourceRowId -> all preserved + needs-review (chosen contract)
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - duplicate sourceRowId', () => {
  it('preserves all rows and marks the group needs-review', () => {
    const result = createRosterImportPreview(
      withRows([
        row('dup', 'Player One'),
        row('dup', 'Player Two'),
        row('solo', 'Player Three'),
      ])
    );
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map((r) => r.status)).toEqual([
      'needs-review',
      'needs-review',
      'ready',
    ]);
    expect(
      result.rows
        .slice(0, 2)
        .every((r) =>
          r.issues.some((i) => i.code === 'duplicate-source-row-id')
        )
    ).toBe(true);
    expect(result.summary.duplicateSourceRowIdGroups).toBe(1);
    expect(result.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. Missing sourceRowId -> preserved + invalid (chosen contract)
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - missing sourceRowId', () => {
  it('preserves the row and marks it invalid', () => {
    const result = createRosterImportPreview(
      withRows([row(undefined, 'Has Name'), row('r2', 'Other Name')])
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].sourceRowId).toBeNull();
    expect(result.rows[0].status).toBe('invalid');
    expect(
      result.rows[0].issues.some((i) => i.code === 'missing-source-row-id')
    ).toBe(true);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 10. Invalid target context is reported
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - target context', () => {
  it('reports invalid target context without mutating rows', () => {
    const result = createRosterImportPreview({
      seasonId: '2026',
      // districtId missing
      ageDivisionId: 'GI',
      teamId: 'alta-GI-A1',
      rows: [row('r1', 'Valid Player')],
    });
    expect(result.targetValid).toBe(false);
    expect(result.target.districtId).toBeNull();
    expect(
      result.issues.some((i) => i.code === 'invalid-target-context')
    ).toBe(true);
    // rows are still built normally and not dropped
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].status).toBe('ready');
    // but the overall preview is not ok
    expect(result.ok).toBe(false);
  });

  it('treats blank target values as missing', () => {
    const result = createRosterImportPreview({
      seasonId: '   ',
      districtId: 'alta',
      ageDivisionId: 'GI',
      teamId: 'alta-GI-A1',
      rows: [],
    });
    expect(result.targetValid).toBe(false);
    expect(result.target.seasonId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 11. ok is false when invalid rows exist
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - ok flag', () => {
  it('is false when any row is invalid even with a valid target', () => {
    const result = createRosterImportPreview(
      withRows([row('r1', 'Good Player'), row('r2', undefined)])
    );
    expect(result.targetValid).toBe(true);
    expect(result.summary.invalidRows).toBe(1);
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 12. Warning/review rows are not discarded
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - review rows retained', () => {
  it('keeps needs-review rows in the result and in valid rows', () => {
    const result = createRosterImportPreview(
      withRows([row('r1', 'Same Name'), row('r2', 'Same Name')])
    );
    expect(result.rows).toHaveLength(2);
    const needsReview = getRosterImportPreviewRowsNeedingReview(result);
    expect(needsReview).toHaveLength(2);
    // not-invalid (valid) rows include needs-review rows
    expect(getValidRosterImportPreviewRows(result)).toHaveLength(2);
  });

  it('getValidRosterImportPreviewRows excludes invalid rows but keeps review rows', () => {
    const result = createRosterImportPreview(
      withRows([
        row('r1', 'Same Name'),
        row('r2', 'Same Name'),
        row('r3', undefined),
        row('r4', 'Clean Player'),
      ])
    );
    const valid = getValidRosterImportPreviewRows(result);
    expect(valid.map((r) => r.sourceRowId)).toEqual(['r1', 'r2', 'r4']);
    expect(getRosterImportPreviewRowsNeedingReview(result)).toHaveLength(2);
  });

  it('the helpers accept a bare rows array too', () => {
    const result = createRosterImportPreview(
      withRows([row('r1', 'Same Name'), row('r2', 'Same Name')])
    );
    expect(getRosterImportPreviewRowsNeedingReview(result.rows)).toHaveLength(
      2
    );
    expect(getValidRosterImportPreviewRows(result.rows)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 13. Summary counts are accurate
// ---------------------------------------------------------------------------

describe('summarizeRosterImportPreviewRows - counts', () => {
  it('tallies statuses, severities, and duplicate groups', () => {
    const result = createRosterImportPreview(
      withRows([
        row('r1', 'Dup Name'), // needs-review (dup name)
        row('r2', 'Dup Name'), // needs-review (dup name)
        row('dup', 'Solo A'), // needs-review (dup source id)
        row('dup', 'Solo B'), // needs-review (dup source id)
        row('r5', undefined), // invalid (missing name)
        row(undefined, 'No Id'), // invalid (missing source id)
        row('r7', 'Clean Player'), // ready
      ])
    );
    const summary = result.summary;
    expect(summary.totalRows).toBe(7);
    expect(summary.readyRows).toBe(1);
    expect(summary.needsReviewRows).toBe(4);
    expect(summary.invalidRows).toBe(2);
    expect(summary.duplicateNameGroups).toBe(1);
    expect(summary.duplicateSourceRowIdGroups).toBe(1);
    expect(summary.errorCount).toBe(2); // missing name + missing source id
    expect(summary.warningCount).toBe(4); // 2 dup-name + 2 dup-source-id
    expect(summary.infoCount).toBe(0);
    // summarize is consistent when called directly on rows
    expect(summarizeRosterImportPreviewRows(result.rows)).toEqual(summary);
  });
});

// ---------------------------------------------------------------------------
// 14. Input object and row objects are not mutated
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - purity', () => {
  it('does not mutate the input object or its rows', () => {
    const rawObj = { source: 'flag-O' };
    const input: RosterImportPreviewInput = withRows([
      { sourceRowId: 'r1', playerName: 'Jordan Smith', raw: rawObj },
      { sourceRowId: 'r1', playerName: 'Jordan Smith' },
    ]);
    const snapshot = JSON.parse(JSON.stringify(input));

    const result = createRosterImportPreview(input);

    expect(JSON.parse(JSON.stringify(input))).toEqual(snapshot);
    // raw is preserved by reference, never mutated
    expect(result.rows[0].fields.raw).toBe(rawObj);
    expect(rawObj).toEqual({ source: 'flag-O' });
  });
});

// ---------------------------------------------------------------------------
// 15. Deterministic output across repeated calls
// ---------------------------------------------------------------------------

describe('createRosterImportPreview - determinism', () => {
  it('produces identical output across repeated calls', () => {
    const input = withRows([
      row('r1', 'Dup Name'),
      row('r1', 'Dup Name'),
      row('r3', undefined),
      row('r4', 'Clean Player', { jerseyNumber: '7', grade: '6', notes: 'n' }),
    ]);
    const a = createRosterImportPreview(input);
    const b = createRosterImportPreview(input);
    expect(a).toEqual(b);
  });
});
