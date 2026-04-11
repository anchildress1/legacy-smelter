/**
 * Advances a frame-based completion window used by the smelter animation.
 * The window completes once cumulative progress reaches `requiredFrames`.
 *
 * Inputs must be finite numbers. Non-finite `currentProgress` or
 * `deltaFrames` would poison the accumulator forever (`NaN + x` stays
 * `NaN`, and `NaN >= requiredFrames` is always `false`), silently
 * stranding the animation in its current phase with no operator signal.
 * The callers never legitimately produce non-finite values — PIXI's
 * ticker always reports a finite `deltaTime` and the internal progress
 * refs start at `0` — so we treat any non-finite value as a
 * programmer error and throw, matching the "crash loudly, don't drift
 * silently" philosophy applied elsewhere in the codebase.
 */
export function advanceAnimationWindow(
  currentProgress: number,
  deltaFrames: number,
  requiredFrames: number,
): { nextProgress: number; isComplete: boolean } {
  if (!Number.isFinite(currentProgress)) {
    throw new TypeError(
      `[animationWindow] currentProgress must be finite (got ${String(currentProgress)})`,
    );
  }
  if (!Number.isFinite(deltaFrames)) {
    throw new TypeError(
      `[animationWindow] deltaFrames must be finite (got ${String(deltaFrames)})`,
    );
  }
  if (!Number.isFinite(requiredFrames)) {
    throw new TypeError(
      `[animationWindow] requiredFrames must be finite (got ${String(requiredFrames)})`,
    );
  }
  const nextProgress = currentProgress + deltaFrames;
  return {
    nextProgress,
    isComplete: nextProgress >= requiredFrames,
  };
}
