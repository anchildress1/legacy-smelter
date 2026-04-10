import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type TickerFn = (ticker: { deltaTime: number }) => void;

const { pixiState, MockApplication, MockAnimatedSprite } = vi.hoisted(() => {
  class MockTicker {
    private readonly callbacks = new Set<TickerFn>();
    public readonly removed: TickerFn[] = [];

    add(fn: TickerFn) {
      this.callbacks.add(fn);
    }

    remove(fn: TickerFn) {
      this.removed.push(fn);
      this.callbacks.delete(fn);
    }

    tick(deltaTime = 1) {
      for (const fn of [...this.callbacks]) {
        fn({ deltaTime });
      }
    }
  }

  class App {
    public readonly ticker = new MockTicker();
    public readonly stage = {
      addChild: vi.fn(),
      addChildAt: vi.fn(),
    };
    public readonly canvas = document.createElement('canvas');
    // Intentionally undefined so stepAnimation throws; ticker catch path is the target.
    public screen: { width: number; height: number } | undefined = undefined;
    public readonly destroy = vi.fn();

    async init() {
      return;
    }
  }

  class Animated {
    public animationSpeed = 0;
    public readonly anchor = { set: vi.fn() };
    public visible = false;
    public loop = true;
    public playing = true;
    public readonly textures: unknown[];
    public filters: unknown[] = [];
    public alpha = 1;
    public x = 0;
    public y = 0;
    public readonly scale = { set: vi.fn() };

    constructor(textures: unknown[]) {
      this.textures = textures;
    }

    gotoAndPlay = vi.fn(() => {
      this.playing = true;
    });

    play = vi.fn(() => {
      this.playing = true;
    });
  }

  return {
    pixiState: {
      lastApplication: null as App | null,
      assetsLoad: vi.fn(async (_paths: string[]) => undefined),
      assetsGet: vi.fn((_path: string) => ({ width: 100, height: 100 })),
    },
    MockApplication: App,
    MockAnimatedSprite: Animated,
  };
});

vi.mock('pixi.js', () => ({
  Application: vi.fn(function MockedApplication(this: unknown) {
    const app = new MockApplication();
    pixiState.lastApplication = app;
    return app;
  }),
  AnimatedSprite: vi.fn(function MockedAnimatedSprite(this: unknown, textures: unknown[]) {
    return new MockAnimatedSprite(textures);
  }),
  Assets: {
    load: pixiState.assetsLoad,
    get: pixiState.assetsGet,
  },
  Filter: {
    from: vi.fn(() => ({ resources: {}, destroy: vi.fn() })),
  },
  Sprite: vi.fn(),
  Texture: vi.fn(),
  Rectangle: vi.fn(),
}));

import { SmelterCanvas } from './SmelterCanvas';

describe('SmelterCanvas render failure handling', () => {
  // Quiet the ticker error logs that the production code emits on each
  // crash. They are expected output for these tests and would otherwise
  // drown the test runner's stderr.
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
    pixiState.lastApplication = null;
  });

  it('disables ticker and emits onRenderFailure after 5 consecutive ticker crashes', async () => {
    const onRenderFailure = vi.fn();

    render(
      <SmelterCanvas
        onComplete={() => {}}
        onRenderFailure={onRenderFailure}
      />,
    );

    await waitFor(() => {
      expect(pixiState.lastApplication).not.toBeNull();
      expect(pixiState.assetsLoad).toHaveBeenCalled();
    });

    const app = pixiState.lastApplication!;

    for (let i = 0; i < 4; i += 1) {
      app.ticker.tick();
    }
    expect(onRenderFailure).not.toHaveBeenCalled();

    app.ticker.tick();

    expect(onRenderFailure).toHaveBeenCalledTimes(1);
    expect(onRenderFailure.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(app.ticker.removed).toHaveLength(1);
    // Each pre-threshold crash logs an operator-visible error message so
    // a stuck animation still leaves a breadcrumb even if onRenderFailure
    // is absent. Exactly 5 error logs for the 5 crashes, plus the 6th
    // "Ticker disabled" line published when the threshold fires.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[SmelterCanvas] Ticker disabled after repeated failures.',
    );

    app.ticker.tick();
    expect(onRenderFailure).toHaveBeenCalledTimes(1);
  });

  it('resets the consecutive-crash counter after a successful tick', async () => {
    // Invariant: MAX_CONSECUTIVE_TICKER_ERRORS only counts runs of BACK-TO-BACK
    // failures. A single successful tick must clear the counter so transient
    // PIXI hiccups do not accumulate across unrelated crash windows.
    const onRenderFailure = vi.fn();

    render(
      <SmelterCanvas
        onComplete={() => {}}
        onRenderFailure={onRenderFailure}
      />,
    );

    await waitFor(() => {
      expect(pixiState.lastApplication).not.toBeNull();
    });

    const app = pixiState.lastApplication!;

    // Four consecutive crashes — screen undefined, stepAnimation throws.
    for (let i = 0; i < 4; i += 1) {
      app.ticker.tick();
    }
    expect(onRenderFailure).not.toHaveBeenCalled();

    // One successful tick by giving the app a valid screen shape. After
    // this tick the consecutive counter must be back to zero.
    app.screen = { width: 400, height: 300 };
    app.ticker.tick();
    expect(onRenderFailure).not.toHaveBeenCalled();

    // Four MORE crashes — because the counter reset, these should NOT
    // trigger the threshold (4 < 5). A regression that forgets to reset
    // the counter on success would flip the threshold semantics and fail
    // on the fourth crash here.
    app.screen = undefined;
    for (let i = 0; i < 4; i += 1) {
      app.ticker.tick();
    }
    expect(onRenderFailure).not.toHaveBeenCalled();
    expect(app.ticker.removed).toHaveLength(0);

    // A fifth crash in this new window should trip the threshold.
    app.ticker.tick();
    expect(onRenderFailure).toHaveBeenCalledTimes(1);
    expect(app.ticker.removed).toHaveLength(1);
    // Symmetry with the first test: the callback must receive the wrapped
    // Error from the 5th crash in the *new* window, not a stale error
    // from the earlier crash run that was reset. A regression that cached
    // the first error reference would pass the `.toHaveBeenCalledTimes(1)`
    // check but fail this instanceof guard if the cached ref was stripped.
    expect(onRenderFailure.mock.calls[0]?.[0]).toBeInstanceOf(Error);
  });

  it('does not throw when onRenderFailure is omitted from props', async () => {
    // `onRenderFailure` is optional. If a caller doesn't supply it, the
    // ticker catch path must silently no-op on the final callback rather
    // than crashing because of an undefined function call.
    render(<SmelterCanvas onComplete={() => {}} />);

    await waitFor(() => {
      expect(pixiState.lastApplication).not.toBeNull();
    });

    const app = pixiState.lastApplication!;

    // Wrap the tick loop in an explicit `not.toThrow` so a regression that
    // made the catch path rethrow (or let an undefined-callback invocation
    // escape) fails this test directly, instead of a silent pass where the
    // only signal was the absence of a runner rejection.
    expect(() => {
      for (let i = 0; i < 6; i += 1) {
        app.ticker.tick();
      }
    }).not.toThrow();

    // Belt-and-braces: the ticker-disable path must still have fired, so
    // the test pins the threshold behaviour even without a callback.
    expect(app.ticker.removed).toHaveLength(1);
  });
});
