import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, signInAnonymously } = vi.hoisted(() => ({
  auth: { currentUser: null as { uid: string } | null },
  signInAnonymously: vi.fn(),
}));

vi.mock('firebase/app', () => ({ initializeApp: vi.fn() }));
vi.mock('firebase/auth', () => ({
  getAuth: () => auth,
  signInAnonymously,
}));
vi.mock('firebase/firestore', () => ({ getFirestore: vi.fn() }));

describe('ensureAnonymousAuth', () => {
  beforeEach(() => {
    vi.resetModules();
    auth.currentUser = null;
    vi.stubEnv('VITE_USE_FIREBASE_EMULATOR', 'false');
    signInAnonymously.mockResolvedValue({ user: { uid: 'anonymous' } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shares one in-flight sign-in and returns no credential to callers', async () => {
    let finishSignIn!: (value: { user: { uid: string } }) => void;
    const pending = new Promise<{ user: { uid: string } }>((resolve) => {
      finishSignIn = resolve;
    });
    signInAnonymously.mockReturnValue(pending);
    const { ensureAnonymousAuth } = await import('./firebase');

    const first = ensureAnonymousAuth();
    const second = ensureAnonymousAuth();
    expect(signInAnonymously).toHaveBeenCalledExactlyOnceWith(auth);

    finishSignIn({ user: { uid: 'anonymous' } });
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    await expect(ensureAnonymousAuth()).resolves.toBeUndefined();
    expect(signInAnonymously).toHaveBeenCalledOnce();
  });

  it('propagates a shared rejection and allows a later retry', async () => {
    const failure = new Error('sign-in rejected');
    let failSignIn!: (reason: Error) => void;
    const pending = new Promise<void>((_, reject) => {
      failSignIn = reject;
    });
    signInAnonymously.mockReturnValueOnce(pending);
    const { ensureAnonymousAuth } = await import('./firebase');

    const results = Promise.allSettled([ensureAnonymousAuth(), ensureAnonymousAuth()]);
    failSignIn(failure);
    await expect(results).resolves.toEqual([
      { status: 'rejected', reason: failure },
      { status: 'rejected', reason: failure },
    ]);
    expect(signInAnonymously).toHaveBeenCalledOnce();

    await expect(ensureAnonymousAuth()).resolves.toBeUndefined();
    expect(signInAnonymously).toHaveBeenCalledTimes(2);
  });

  it('does not sign in when a user is already authenticated', async () => {
    auth.currentUser = { uid: 'existing' };
    const { ensureAnonymousAuth } = await import('./firebase');

    await expect(ensureAnonymousAuth()).resolves.toBeUndefined();
    expect(signInAnonymously).not.toHaveBeenCalled();
  });
});
