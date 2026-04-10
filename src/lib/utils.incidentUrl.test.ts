import { describe, expect, it } from 'vitest';
import { buildIncidentUrl } from './utils';

describe('buildIncidentUrl', () => {
  it('uses the canonical /s/:id share path', () => {
    const url = new URL(buildIncidentUrl('incident-123'));
    expect(url.pathname.endsWith('/s/incident-123')).toBe(true);
  });

  it('URL-encodes incident ids before appending to /s/:id', () => {
    const id = 'inc/with spaces?and&symbols';
    const url = buildIncidentUrl(id);
    expect(url).toContain(`/s/${encodeURIComponent(id)}`);
  });
});
