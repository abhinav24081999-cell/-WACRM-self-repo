import { expect, it } from 'vitest';
import { isCommercialDate } from './commercial';

it('accepts actual calendar dates only', () => {
  expect(isCommercialDate('2024-02-29')).toBe(true);
  expect(isCommercialDate('2026-02-29')).toBe(false);
  expect(isCommercialDate('2026-11-31')).toBe(false);
  expect(isCommercialDate('2026-11-01T00:00:00Z')).toBe(false);
  expect(isCommercialDate(null)).toBe(false);
});
