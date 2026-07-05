import { describe, it, expect } from 'vitest';
import { interpretScrapedCoachTitle } from '../engine/scrapedCoachTitleRole';

describe('interpretScrapedCoachTitle', () => {
  it('recognizes head-coach titles', () => {
    expect(interpretScrapedCoachTitle('Head Coach')).toBe('head');
    expect(interpretScrapedCoachTitle('HEAD COACH')).toBe('head');
    expect(interpretScrapedCoachTitle('  head coach ')).toBe('head');
  });

  it('recognizes assistant-coach titles including the "Asst" abbreviation', () => {
    expect(interpretScrapedCoachTitle('Asst Coach')).toBe('assistant');
    expect(interpretScrapedCoachTitle('Assistant Coach')).toBe('assistant');
    expect(interpretScrapedCoachTitle('asst. coach')).toBe('assistant');
  });

  it('treats a missing/blank title as unrecognized (blocks, never guesses)', () => {
    expect(interpretScrapedCoachTitle(null)).toBe('unrecognized');
    expect(interpretScrapedCoachTitle(undefined)).toBe('unrecognized');
    expect(interpretScrapedCoachTitle('')).toBe('unrecognized');
    expect(interpretScrapedCoachTitle('   ')).toBe('unrecognized');
  });

  it('treats an unsupported title as unrecognized (no invented ontology)', () => {
    expect(interpretScrapedCoachTitle('Offensive Coordinator')).toBe('unrecognized');
    expect(interpretScrapedCoachTitle('Team Parent')).toBe('unrecognized');
  });

  it('treats an ambiguous head+assistant title as unrecognized', () => {
    expect(interpretScrapedCoachTitle('Assistant Head Coach')).toBe('unrecognized');
  });
});
