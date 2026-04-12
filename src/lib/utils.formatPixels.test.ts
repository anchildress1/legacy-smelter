import { describe, expect, it } from 'vitest';
import { formatPixels } from './utils';

describe('formatPixels', () => {
  it('keeps raw pixels below 1k', () => {
    expect(formatPixels(999)).toEqual({ value: '999', unit: 'PIXELS' });
  });

  it('handles zero pixels', () => {
    expect(formatPixels(0)).toEqual({ value: '0', unit: 'PIXELS' });
  });

  it('formats kilo/mega/giga scales and trims trailing zeros', () => {
    expect(formatPixels(1_000)).toEqual({ value: '1', unit: 'KILOPIXELS' });
    expect(formatPixels(1_250_000)).toEqual({ value: '1.25', unit: 'MEGAPIXELS' });
    expect(formatPixels(1_234_567_890)).toEqual({
      value: '1.235',
      unit: 'GIGAPIXELS',
    });
  });

  it('formats tera/peta scales', () => {
    expect(formatPixels(1_000_000_000_000)).toEqual({
      value: '1',
      unit: 'TERAPIXELS',
    });
    expect(formatPixels(1_500_000_000_000_000)).toEqual({
      value: '1.5',
      unit: 'PETAPIXELS',
    });
  });

  it('formats correctly at scale boundaries', () => {
    // Just under 1k stays raw
    expect(formatPixels(999)).toEqual({ value: '999', unit: 'PIXELS' });
    // Exactly 1k becomes 1 kilo
    expect(formatPixels(1_000)).toEqual({ value: '1', unit: 'KILOPIXELS' });
    // Just over 1k becomes 1.001 kilo with precision preserved
    expect(formatPixels(1_001)).toEqual({ value: '1.001', unit: 'KILOPIXELS' });
  });
});
