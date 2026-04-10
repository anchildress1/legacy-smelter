import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';

// `vitest.config.ts` wires this file as a global `setupFiles` entry, which
// means it runs inside Node-environment test files too — every file in
// `scripts/*.test.ts` declares `// @vitest-environment node`. Those tests do
// not render React, so we deliberately avoid importing
// `@testing-library/react` at module scope: a future RTL version that
// touches `document`/`window` at import time would silently break every
// Node-env suite. Instead, the DOM-specific cleanup is loaded lazily inside
// `afterEach` and guarded on `typeof document` so the Node runs stay
// completely decoupled from the DOM.

const IS_DOM_ENVIRONMENT = typeof document !== 'undefined';

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}

beforeEach(() => {
  const local = makeStorage();
  const session = makeStorage();

  Object.defineProperty(globalThis, 'localStorage', {
    value: local,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'sessionStorage', {
    value: session,
    configurable: true,
    writable: true,
  });

  if (typeof globalThis.window !== 'undefined') {
    Object.defineProperty(globalThis.window, 'localStorage', {
      value: local,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis.window, 'sessionStorage', {
      value: session,
      configurable: true,
      writable: true,
    });
  }
});

afterEach(async () => {
  // Only run React Testing Library cleanup when a DOM is actually available.
  // Node-env test files share this setup file but never render React, so
  // importing RTL there would couple the Node suites to the DOM for no
  // benefit.
  if (!IS_DOM_ENVIRONMENT) return;
  const { cleanup } = await import('@testing-library/react');
  cleanup();
});
