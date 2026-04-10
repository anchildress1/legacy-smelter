import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

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
      return map.has(key) ? map.get(key)! : null;
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

  if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'localStorage', {
      value: local,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'sessionStorage', {
      value: session,
      configurable: true,
      writable: true,
    });
  }
});

afterEach(() => {
  cleanup();
});
