export const POSTMORTEM_AUTO_OPEN_STORAGE_KEY = 'smelter-postmortem-auto';

interface AutoOpenPolicyOptions {
  readonly win?: Pick<Window, 'matchMedia'> | null;
  readonly storage?: Pick<Storage, 'getItem'> | null;
}

function getWindowSafe(): Pick<Window, 'matchMedia'> | null {
  if (globalThis.window === undefined) return null;
  return globalThis.window;
}

function getLocalStorageSafe(): Pick<Storage, 'getItem'> | null {
  if (globalThis.window === undefined) return null;
  try {
    return globalThis.window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Returns whether the postmortem should auto-open after smelt completion.
 * Defaults to auto-open unless reduced motion is preferred or the explicit
 * user opt-out flag (`smelter-postmortem-auto = "false"`) is present.
 *
 * Reads are guarded so unsupported or storage-blocked environments fall
 * back to a safe default instead of throwing in the completion path.
 */
export function shouldAutoOpenPostmortem(
  options?: AutoOpenPolicyOptions,
): boolean {
  const win = options?.win ?? getWindowSafe();
  let prefersReducedMotion = false;
  if (win && typeof win.matchMedia === 'function') {
    try {
      prefersReducedMotion = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      prefersReducedMotion = false;
    }
  }

  const storage = options?.storage ?? getLocalStorageSafe();
  let autoOpenDisabled = false;
  if (storage) {
    try {
      autoOpenDisabled =
        storage.getItem(POSTMORTEM_AUTO_OPEN_STORAGE_KEY) === 'false';
    } catch {
      autoOpenDisabled = false;
    }
  }

  return !prefersReducedMotion && !autoOpenDisabled;
}
