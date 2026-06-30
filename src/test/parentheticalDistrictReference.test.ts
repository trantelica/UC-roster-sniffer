import { describe, it, expect } from 'vitest';
import { parseParentheticalDistrictReference } from '../engine/parentheticalDistrictReference';

describe('parseParentheticalDistrictReference', () => {
  it('parses "GridIron A1 (Layton)" into original label, base label, and district candidate', () => {
    const ref = parseParentheticalDistrictReference('GridIron A1 (Layton)');
    expect(ref).not.toBeNull();
    expect(ref?.originalLabel).toBe('GridIron A1 (Layton)');
    expect(ref?.baseLabel).toBe('GridIron A1');
    expect(ref?.districtCandidate).toBe('Layton');
  });

  it('preserves the original label EXACTLY and trims only the split parts', () => {
    const ref = parseParentheticalDistrictReference('  Gremlin B2  ( Bingham Girls ) ');
    expect(ref?.originalLabel).toBe('  Gremlin B2  ( Bingham Girls ) ');
    expect(ref?.baseLabel).toBe('Gremlin B2');
    expect(ref?.districtCandidate).toBe('Bingham Girls');
  });

  it('returns null when there is no parenthetical (existing non-parenthetical behavior)', () => {
    expect(parseParentheticalDistrictReference('GridIron A1')).toBeNull();
    expect(parseParentheticalDistrictReference('Scout White')).toBeNull();
  });

  it('returns null for an empty base or empty candidate', () => {
    expect(parseParentheticalDistrictReference('(Layton)')).toBeNull();
    expect(parseParentheticalDistrictReference('GridIron A1 ()')).toBeNull();
    expect(parseParentheticalDistrictReference('GridIron A1 (   )')).toBeNull();
  });

  it('returns null for a nested parenthetical group (ambiguous)', () => {
    expect(parseParentheticalDistrictReference('GridIron A1 (Layton (North))')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(parseParentheticalDistrictReference(null)).toBeNull();
    expect(parseParentheticalDistrictReference(undefined)).toBeNull();
  });
});
