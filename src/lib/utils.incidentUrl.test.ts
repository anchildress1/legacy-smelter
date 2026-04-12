import { describe, expect, it } from 'vitest';
import { buildIncidentUrl } from './utils';

describe('buildIncidentUrl', () => {
  it('uses the canonical /s/:id share path', () => {
    const url = new URL(buildIncidentUrl('incident-123'));
    expect(url.pathname.endsWith('/s/incident-123')).toBe(true);
  });

  it.each([
    ['simple-id', 'simple-id'],
    ['with spaces', 'with%20spaces'],
    ['with/slash', 'with%2Fslash'],
    ['with?query', 'with%3Fquery'],
    ['with&ampersand', 'with%26ampersand'],
    ['with#hash', 'with%23hash'],
    ['mixed/space?and&symbols', 'mixed%2Fspace%3Fand%26symbols'],
  ])('encodes incident id "%s" correctly as "%s"', (id, encoded) => {
    const url = buildIncidentUrl(id);
    expect(url).toContain(`/s/${encoded}`);
  });
});
