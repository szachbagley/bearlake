import { describe, expect, it } from 'vitest';
import { formatInstant } from '../../src/utils/dates.ts';

describe('formatInstant', () => {
  it('formats an ISO instant as a readable local date and time', () => {
    const formatted = formatInstant('2026-07-16T18:30:00.000Z');
    expect(formatted).toMatch(/2026/);
    expect(formatted).toMatch(/\d/);
  });
});
