import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SmelterCanvasHandle } from './SmelterCanvas';

// These tests cover the parts of `SmelterCanvas` that the existing
// `SmelterCanvas.renderFailure.test.tsx` intentionally leaves alone:
//   1. `replay()` must reset the melt filter uniforms so the second
//      run-through does not render the image pre-melted.
//   2. `replay()` must not crash when the component has not yet loaded
//      an image (i.e. `meltFilterRef.current === null`).
//   3. The unmount cleanup must call `app.destroy` with
//      `{ texture: false }`, otherwise the warning documented in the
//      component cleanup comment (sprite frames owned by PIXI.Assets)
//      re-appears on every remount.
//
// The crash-path test file has a minimal PIXI mock that does not model
// the parts of `loadAndSmelt` this suite needs (image load, filter
// construction with real uniform storage), so we define a fuller mock
// here instead of sharing one.

type TickerFn = (ticker: { deltaTime: number }) => void;

interface FilterResources {
  puddleUniforms?: {
    uniforms: {
      uColor1: [number, number, number];
      uColor2: [number, number, number];
      uColor3: [number, number, number];
    };
  };
  meltUniforms?: {
    uniforms: {
      uTime: number;
      uMeltAmount: number;
    };
  };
}

// Config shape passed to `PIXI.Filter.from` by the component. At
// runtime PIXI reshapes each `{ value, type }` entry into a live
// `.uniforms` dict on the resource. The mock does the same reshape so
// `filter.resources.meltUniforms.uniforms.uMeltAmount` (the production
// access path in `replay()` and `advanceMeltShader`) is a live
// mutable field.
interface FilterConfigResource {
  [uniformName: string]: { value: unknown; type: string };
}
interface FilterConfig {
  readonly gl?: unknown;
  readonly resources?: Record<string, FilterConfigResource>;
}

const { pixiState, MockApplication, MockAnimatedSprite, MockSprite, MockFilter } =
  vi.hoisted(() => {
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
          fn({ deltaTime } as unknown as Parameters<TickerFn>[0]);
        }
      }
    }

    class MockStage {
      public children: unknown[] = [];
      addChild = vi.fn((child: unknown) => {
        this.children.push(child);
      });
      addChildAt = vi.fn((child: unknown, _index: number) => {
        this.children.unshift(child);
      });
    }

    class App {
      public readonly ticker = new MockTicker();
      public readonly stage = new MockStage();
      public readonly canvas = document.createElement('canvas');
      public screen: { width: number; height: number } = { width: 800, height: 600 };
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
      public textures: unknown[];
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

    class Sprite {
      public anchor = { set: vi.fn() };
      public filters: unknown[] = [];
      public visible = true;
      public alpha = 1;
      public tint = 0xffffff;
      public x = 0;
      public y = 0;
      public scale = {
        x: 1,
        y: 1,
        set: vi.fn((x: number, y?: number) => {
          this.scale.x = x;
          this.scale.y = y ?? x;
        }),
      };
      // A minimal texture shape: loadAndSmelt reads width/height on the
      // sprite's texture for scaling, and calls texture.destroy on
      // unmount.
      public texture = {
        width: 100,
        height: 100,
        destroy: vi.fn(),
      };
      public removeFromParent = vi.fn();

      constructor(public readonly passedTexture: unknown) {}
    }

    class Filter {
      public resources: FilterResources;
      public destroy = vi.fn();

      constructor(config: FilterConfig) {
        // PIXI's runtime reshape: each resource block has a
        // `.uniforms` dict where the values live, alongside the
        // original typed config. The production code writes to
        // `resources.meltUniforms.uniforms.uMeltAmount` — so the mock
        // must present a live mutable `uniforms` property, not just
        // the raw `{ value, type }` wrapped form.
        const resources: FilterResources = {};
        for (const [blockName, block] of Object.entries(config.resources ?? {})) {
          const uniforms: Record<string, unknown> = {};
          for (const [uniformName, descriptor] of Object.entries(block)) {
            uniforms[uniformName] = descriptor.value;
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (resources as any)[blockName] = { ...block, uniforms };
        }
        this.resources = resources;
      }
    }

    return {
      pixiState: {
        lastApplication: null as App | null,
        assetsLoad: vi.fn(async (_paths: string[]) => undefined),
        assetsGet: vi.fn((_path: string) => ({ width: 100, height: 100 })),
        filters: [] as Filter[],
      },
      MockApplication: App,
      MockAnimatedSprite: Animated,
      MockSprite: Sprite,
      MockFilter: Filter,
    };
  });

vi.mock('pixi.js', () => ({
  Application: vi.fn(function MockedApplication(this: unknown) {
    const app = new MockApplication();
    pixiState.lastApplication = app;
    return app;
  }),
  AnimatedSprite: vi.fn(function MockedAnimatedSprite(
    this: unknown,
    textures: unknown[],
  ) {
    return new MockAnimatedSprite(textures);
  }),
  Assets: {
    load: pixiState.assetsLoad,
    get: pixiState.assetsGet,
  },
  Filter: {
    from: vi.fn((config: FilterConfig) => {
      const filter = new MockFilter(config);
      pixiState.filters.push(filter);
      return filter;
    }),
  },
  Sprite: vi.fn(function MockedSprite(this: unknown, tex: unknown) {
    return new MockSprite(tex);
  }),
  Texture: Object.assign(
    vi.fn(function MockedTexture(this: unknown, _config: unknown) {
      return { width: 100, height: 100, destroy: vi.fn() };
    }),
    {
      from: vi.fn((_img: unknown) => ({
        source: {},
        width: 100,
        height: 100,
        destroy: vi.fn(),
      })),
    },
  ),
  Rectangle: vi.fn(function MockedRectangle(
    this: unknown,
    _x: number,
    _y: number,
    _w: number,
    _h: number,
  ) {
    return {};
  }),
}));

// Stub the global Image constructor so `img.onload` resolves
// synchronously inside `loadAndSmelt`. The real DOM Image requires a
// network-addressable src; in jsdom it never fires `onload`, which would
// hang `loadAndSmelt`'s inner promise forever.
class MockImage {
  public onload: (() => void) | null = null;
  public onerror: ((err: unknown) => void) | null = null;
  public crossOrigin = '';
  public width = 100;
  public height = 100;
  private _src = '';
  get src() {
    return this._src;
  }
  set src(value: string) {
    this._src = value;
    // Fire onload in a microtask so the awaited Promise in loadAndSmelt
    // has a chance to set the handlers first.
    queueMicrotask(() => {
      this.onload?.();
    });
  }
}

describe('SmelterCanvas happy path', () => {
  beforeEach(() => {
    vi.stubGlobal('Image', MockImage as unknown as typeof Image);
    // Quiet the PIXI initialization logs that would otherwise fire
    // during render. Any unexpected error during init is still visible
    // via explicit spy assertions where the test cares about it.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    pixiState.lastApplication = null;
    pixiState.filters.length = 0;
  });

  it('installs melt and puddle filters through loadAndSmelt and resets them on replay()', async () => {
    const handleRef = React.createRef<SmelterCanvasHandle>();

    // Render inside a `React.createElement` call to avoid needing JSX's
    // generic ref typing: `createRef<SmelterCanvasHandle>` matches the
    // `forwardRef` handle type directly.
    const { SmelterCanvas } = await import('./SmelterCanvas');
    render(
      <SmelterCanvas ref={handleRef} onComplete={vi.fn()} onFireStart={vi.fn()} />,
    );

    await waitFor(() => {
      expect(pixiState.lastApplication).not.toBeNull();
      expect(pixiState.assetsLoad).toHaveBeenCalled();
    });

    // Drive the happy-path smelt setup. The image URL is consumed by
    // MockImage, which fires onload in a microtask.
    await handleRef.current?.loadAndSmelt(
      'https://example.test/img.png',
      [0, 0, 1000, 1000],
      ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff'],
    );

    // Two filters must be created: the puddle palette-swap filter and
    // the melt filter. Both carry their own uniform blocks.
    expect(pixiState.filters.length).toBe(2);
    const meltFilter = pixiState.filters.find((f) => f.resources.meltUniforms);
    const puddleFilter = pixiState.filters.find((f) => f.resources.puddleUniforms);
    expect(meltFilter).toBeDefined();
    expect(puddleFilter).toBeDefined();

    // Simulate the melt progressing: the ticker would normally advance
    // uMeltAmount to some non-zero value. We mutate directly so the
    // replay() reset has something to clear.
    meltFilter!.resources.meltUniforms!.uniforms.uMeltAmount = 0.7;
    meltFilter!.resources.meltUniforms!.uniforms.uTime = 4.2;

    handleRef.current?.replay();

    // After replay(), the uniforms MUST be back to zero. A regression
    // that forgot to reset them would render the second replay with a
    // pre-melted sprite — visually broken with no crash.
    expect(meltFilter!.resources.meltUniforms!.uniforms.uMeltAmount).toBe(0);
    expect(meltFilter!.resources.meltUniforms!.uniforms.uTime).toBe(0);
  });

  it('tolerates replay() before the first loadAndSmelt without crashing', async () => {
    // The `meltFilterRef` is null until the first `loadAndSmelt` runs.
    // A caller that clicks "replay" before the first smelt (e.g.
    // keyboard shortcut during the idle phase) must not crash — the
    // component simply no-ops the uniform reset and falls through into
    // beginSequence, which itself early-returns when the pixi state is
    // not yet ready.
    const handleRef = React.createRef<SmelterCanvasHandle>();
    const { SmelterCanvas } = await import('./SmelterCanvas');
    render(<SmelterCanvas ref={handleRef} onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(pixiState.lastApplication).not.toBeNull();
    });

    expect(() => handleRef.current?.replay()).not.toThrow();
    // No filter should have been created — replay must not fabricate
    // one on its own.
    expect(pixiState.filters.length).toBe(0);
  });

  it('destroys the PIXI app with texture:false on unmount to preserve the Assets cache', async () => {
    // The cleanup comment in SmelterCanvas.tsx explicitly documents that
    // `app.destroy({ texture: true })` triggers "Texture managed by
    // Assets was destroyed instead of unloaded" warnings because the
    // dragon and puddle frames are owned by PIXI.Assets. Pinning the
    // `{ texture: false }` argument shape ensures a refactor that
    // "simplifies" the cleanup to `app.destroy(true, { children: true
    // })` (picking up the default `texture: true`) gets flagged here.
    const { SmelterCanvas } = await import('./SmelterCanvas');
    const { unmount } = render(<SmelterCanvas onComplete={vi.fn()} />);

    await waitFor(() => {
      expect(pixiState.lastApplication).not.toBeNull();
    });

    const app = pixiState.lastApplication!;
    unmount();

    expect(app.destroy).toHaveBeenCalledWith(true, {
      children: true,
      texture: false,
    });
  });
});
