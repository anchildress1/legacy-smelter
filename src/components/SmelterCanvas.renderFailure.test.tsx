import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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

    app.ticker.tick();
    expect(onRenderFailure).toHaveBeenCalledTimes(1);
  });
});
