import { describe, expect, it, vi } from 'vitest';
import {
  POSTMORTEM_AUTO_OPEN_STORAGE_KEY,
  shouldAutoOpenPostmortem,
} from './postmortemAutoOpen';

describe('shouldAutoOpenPostmortem', () => {
  it('returns true when both reduced motion is false and no opt-out is set', () => {
    const win = {
      matchMedia: vi.fn(() => ({ matches: false })),
    } as unknown as Pick<Window, 'matchMedia'>;
    const storage = {
      getItem: vi.fn(() => null),
    } as unknown as Pick<Storage, 'getItem'>;

    expect(shouldAutoOpenPostmortem({ win, storage })).toBe(true);
  });

  it('returns false when reduced-motion media query matches', () => {
    const win = {
      matchMedia: vi.fn(() => ({ matches: true })),
    } as unknown as Pick<Window, 'matchMedia'>;
    const storage = {
      getItem: vi.fn(() => null),
    } as unknown as Pick<Storage, 'getItem'>;

    expect(shouldAutoOpenPostmortem({ win, storage })).toBe(false);
  });

  it('returns false when localStorage opt-out flag is set to false', () => {
    const win = {
      matchMedia: vi.fn(() => ({ matches: false })),
    } as unknown as Pick<Window, 'matchMedia'>;
    const storage = {
      getItem: vi.fn((key: string) =>
        key === POSTMORTEM_AUTO_OPEN_STORAGE_KEY ? 'false' : null,
      ),
    } as unknown as Pick<Storage, 'getItem'>;

    expect(shouldAutoOpenPostmortem({ win, storage })).toBe(false);
  });

  it('returns true when both browser APIs are unavailable', () => {
    expect(
      shouldAutoOpenPostmortem({
        win: { matchMedia: undefined } as unknown as Pick<Window, 'matchMedia'>,
        storage: null,
      }),
    ).toBe(true);
  });

  it('returns true when matchMedia throws in a restricted environment', () => {
    const win = {
      matchMedia: vi.fn(() => {
        throw new Error('matchMedia blocked');
      }),
    } as unknown as Pick<Window, 'matchMedia'>;
    const storage = {
      getItem: vi.fn(() => null),
    } as unknown as Pick<Storage, 'getItem'>;

    expect(shouldAutoOpenPostmortem({ win, storage })).toBe(true);
  });

  it('returns true when localStorage.getItem throws SecurityError', () => {
    const win = {
      matchMedia: vi.fn(() => ({ matches: false })),
    } as unknown as Pick<Window, 'matchMedia'>;
    const storage = {
      getItem: vi.fn(() => {
        throw new DOMException('Access denied', 'SecurityError');
      }),
    } as unknown as Pick<Storage, 'getItem'>;

    expect(shouldAutoOpenPostmortem({ win, storage })).toBe(true);
  });
});
