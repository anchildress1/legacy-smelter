import { describe, expect, it } from 'vitest';
import { buildShareLinks, getLogShareLinks } from './utils';
import { makeFixtureLog } from '../test/smeltLogFixtures';

/**
 * Pins the share-URL shapes. Each intent URL has to survive a round
 * trip through the third-party's parser — a single missing `encodeURI`
 * call is the difference between a valid share link and one that
 * Twitter's composer silently drops.
 */

describe('buildShareLinks', () => {
  const TEXT = 'check it out';
  const HEADLINE = 'Big Incident';
  const PAGE = 'https://example.com/s/abc';

  it('returns exactly four entries in the canonical order', () => {
    const links = buildShareLinks(TEXT, HEADLINE, PAGE);
    expect(links.map((l) => l.label)).toEqual(['twitter', 'linkedin', 'bluesky', 'reddit']);
  });

  it('URL-encodes the share text into the twitter intent', () => {
    const [twitter] = buildShareLinks(TEXT, HEADLINE, PAGE);
    expect(twitter.label).toBe('twitter');
    expect(twitter.href).toContain('https://twitter.com/intent/tweet?');
    expect(twitter.href).toContain(`text=${encodeURIComponent(TEXT)}`);
    expect(twitter.href).toContain(`url=${encodeURIComponent(PAGE)}`);
  });

  it('URL-encodes the headline and summary into the linkedin share URL', () => {
    const [, linkedin] = buildShareLinks(TEXT, HEADLINE, PAGE);
    expect(linkedin.label).toBe('linkedin');
    expect(linkedin.href).toContain('mini=true');
    expect(linkedin.href).toContain(`url=${encodeURIComponent(PAGE)}`);
    expect(linkedin.href).toContain(`title=${encodeURIComponent(HEADLINE)}`);
    expect(linkedin.href).toContain(`summary=${encodeURIComponent(TEXT)}`);
  });

  it('combines text and url into a single bluesky compose text (no separate url param)', () => {
    // Bluesky's compose intent does not accept a `url` param — the URL
    // has to be appended to the text payload so it renders as a link
    // inline in the composer.
    const [, , bluesky] = buildShareLinks(TEXT, HEADLINE, PAGE);
    expect(bluesky.label).toBe('bluesky');
    expect(bluesky.href).toContain('https://bsky.app/intent/compose?');
    expect(bluesky.href).toContain(`text=${encodeURIComponent(`${TEXT} ${PAGE}`)}`);
  });

  it('URL-encodes the headline and url for the reddit submission intent', () => {
    const [, , , reddit] = buildShareLinks(TEXT, HEADLINE, PAGE);
    expect(reddit.label).toBe('reddit');
    expect(reddit.href).toContain('https://www.reddit.com/submit?');
    expect(reddit.href).toContain(`url=${encodeURIComponent(PAGE)}`);
    expect(reddit.href).toContain(`title=${encodeURIComponent(HEADLINE)}`);
  });

  it('escapes characters that would otherwise break the query string', () => {
    const links = buildShareLinks('hello & goodbye', 'a=b', 'https://x.test/s/q?z=1');
    for (const link of links) {
      // Every raw character that would need escaping must NOT appear
      // unescaped inside the query payload.
      expect(link.href).not.toContain('&goodbye');
      expect(link.href).not.toContain('a=b&'); // headline unescaped
      expect(link.href).not.toContain('?z=1&'); // page url unescaped
    }
  });
});

describe('getLogShareLinks', () => {
  it('builds an incident URL from the log id and combines quote + summary into share text', () => {
    const log = makeFixtureLog('inc-xyz', {
      share_quote: 'the quote',
      incident_feed_summary: 'the summary',
      og_headline: 'Headline 1',
    });
    const links = getLogShareLinks(log);
    const twitter = links.find((l) => l.label === 'twitter');
    expect(twitter).toBeDefined();
    // Share text is "quote\n\nsummary" — encoded in the twitter text param.
    const expectedText = encodeURIComponent('the quote\n\nthe summary');
    expect(twitter?.href).toContain(`text=${expectedText}`);
    // The incident URL must be the canonical /s/:id path for the log.
    expect(twitter?.href).toContain(encodeURIComponent('/s/inc-xyz'));
  });

  it('encodes the og_headline into linkedin title and reddit title params', () => {
    const log = makeFixtureLog('inc-1', { og_headline: 'A & B' });
    const links = getLogShareLinks(log);
    const linkedin = links.find((l) => l.label === 'linkedin');
    const reddit = links.find((l) => l.label === 'reddit');
    expect(linkedin?.href).toContain(`title=${encodeURIComponent('A & B')}`);
    expect(reddit?.href).toContain(`title=${encodeURIComponent('A & B')}`);
  });
});
