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
    // Negative deltas are tolerated as a pure math property, NOT a
    // supported use case — PIXI's ticker always reports a positive
    // deltaTime at the only production callsite. This test exists so a
    // future refactor that clamps negative deltas to zero can do so
    // deliberately (delete this test + add a clamp test) instead of
    // silently changing behaviour.
    expect(advanceAnimationWindow(10, -4, 40)).toEqual({
      nextProgress: 6,
      isComplete: false,
    });
  });

  it('throws on non-finite currentProgress to prevent silent NaN propagation', () => {
    // Returning `{ nextProgress: NaN, isComplete: false }` would strand the
    // animation in its current phase forever because `NaN >= x` is always
    // `false`. Throw loudly so the ticker error handler can flag it.
    expect(() => advanceAnimationWindow(Number.NaN, 1, 40)).toThrow(
      '[animationWindow] currentProgress must be finite',
    );
  });

  it('throws on non-finite deltaFrames', () => {
    expect(() => advanceAnimationWindow(10, Number.POSITIVE_INFINITY, 40)).toThrow(
      '[animationWindow] deltaFrames must be finite',
    );
  });

  it('throws on non-finite requiredFrames', () => {
    expect(() => advanceAnimationWindow(10, 5, Number.NaN)).toThrow(
      '[animationWindow] requiredFrames must be finite',
    );
  });

  it('completes immediately when required frames is zero', () => {
    expect(advanceAnimationWindow(0, 1, 0)).toEqual({
      nextProgress: 1,
      isComplete: true,
    });
  });
});
