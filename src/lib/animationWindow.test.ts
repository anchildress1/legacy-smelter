import { describe, expect, it } from 'vitest';
import { advanceAnimationWindow } from './animationWindow';

describe('advanceAnimationWindow', () => {
  it('keeps window open when progress stays below required frames', () => {
    expect(advanceAnimationWindow(20, 10, 40)).toEqual({
      nextProgress: 30,
      isComplete: false,
    });
  });

  it('completes window when progress lands exactly on required frames', () => {
    expect(advanceAnimationWindow(30, 10, 40)).toEqual({
      nextProgress: 40,
      isComplete: true,
    });
  });

  it('completes window when progress overshoots required frames', () => {
    expect(advanceAnimationWindow(39.5, 2.5, 40)).toEqual({
      nextProgress: 42,
      isComplete: true,
    });
  });

  it('supports negative deltas without throwing', () => {
    expect(advanceAnimationWindow(10, -4, 40)).toEqual({
      nextProgress: 6,
      isComplete: false,
    });
  });

  it('returns non-complete for NaN progress values', () => {
    const result = advanceAnimationWindow(Number.NaN, 1, 40);
    expect(Number.isNaN(result.nextProgress)).toBe(true);
    expect(result.isComplete).toBe(false);
  });
});
