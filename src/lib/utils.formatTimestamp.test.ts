import { describe, expect, it } from 'vitest';
import { formatTimestamp } from './utils';

/**
 * `formatTimestamp` produces the canonical `YYYY.MM.DD // HH:MM:SS TZ`
 * string used by every incident card and the overlay. The output is
 * pinned to America/New_York so feeds appear in the same timezone
 * regardless of where the viewer is geolocated — matching the server
 * region. These tests pin that property so a refactor cannot silently
 * re-home the formatter.
 */

describe('formatTimestamp', () => {
  it('renders the canonical shape for a UTC instant', () => {
    // 2026-04-10T17:30:45Z is 13:30:45 America/New_York (EDT / UTC-4).
    // The exact timezone abbreviation ("EDT") is environment-dependent
    // on some engines; match only the structure to stay portable.
    const formatted = formatTimestamp(new Date('2026-04-10T17:30:45Z'));
    expect(formatted).toMatch(
      /^\d{4}\.\d{2}\.\d{2} \/\/ \d{2}:\d{2}:\d{2} [A-Z]{1,5}(?:[+-]\d+)?$/,
    );
  });

  it('reports the America/New_York wall clock rather than UTC', () => {
    // 04:00:00 UTC on 2026-01-15 is 23:00:00 the previous day in EST.
    const formatted = formatTimestamp(new Date('2026-01-15T04:00:00Z'));
    expect(formatted).toContain('2026.01.14');
    expect(formatted).toContain('23:00:00');
  });

  it('uses a 24-hour clock (13:00, not 1:00)', () => {
    const formatted = formatTimestamp(new Date('2026-06-15T17:00:00Z'));
    // 17:00 UTC → 13:00 EDT (summer). 24-hour clock must not render "1:00".
    expect(formatted).toMatch(/\/\/ 13:00:00 /);
  });

  it('zero-pads month, day, hour, minute, and second', () => {
    const formatted = formatTimestamp(new Date('2026-03-05T12:05:09Z'));
    // Verify each field is two digits; the exact wall-clock values
    // depend on the Intl data so only assert the padding contract.
    const dateMatch = formatted.match(/^(\d{4})\.(\d{2})\.(\d{2}) \/\/ (\d{2}):(\d{2}):(\d{2}) /);
    expect(dateMatch).not.toBeNull();
    expect(dateMatch?.[1]).toHaveLength(4);
    expect(dateMatch?.[2]).toHaveLength(2);
    expect(dateMatch?.[3]).toHaveLength(2);
  });

  it('differs by exactly one second between adjacent instants', () => {
    // Pins that the formatter carries second precision — an earlier
    // iteration only showed hour:minute, which is not enough to
    // disambiguate events that happen in the same minute.
    const a = formatTimestamp(new Date('2026-04-10T12:00:00Z'));
    const b = formatTimestamp(new Date('2026-04-10T12:00:01Z'));
    expect(a).not.toBe(b);
  });
});
