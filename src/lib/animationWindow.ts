/**
 * Advances a frame-based completion window used by the smelter animation.
 * The window completes once cumulative progress reaches `requiredFrames`.
 */
export function advanceAnimationWindow(
  currentProgress: number,
  deltaFrames: number,
  requiredFrames: number,
): { nextProgress: number; isComplete: boolean } {
  const nextProgress = currentProgress + deltaFrames;
  return {
    nextProgress,
    isComplete: nextProgress >= requiredFrames,
  };
}
