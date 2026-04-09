import React, { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import * as PIXI from 'pixi.js';
import { getFiveDistinctColors } from '../lib/utils';

export interface SmelterCanvasHandle {
  loadAndSmelt: (imageUrl: string, subjectBox: number[] | null, colors: string[]) => Promise<void>;
  replay: () => void;
}

interface SmelterCanvasProps {
  onComplete: () => void;
  onFlyInStart?: () => void;
  onFireStart?: () => void;
}

type AnimPhase = 'empty' | 'flying_in' | 'landing' | 'melting' | 'settling' | 'complete';

// Standard PixiJS v8 vertex shader for filters
const FILTER_VERT = `
    attribute vec2 aPosition;
    varying vec2 vTextureCoord;
    uniform vec4 uInputSize;
    uniform vec4 uOutputFrame;
    uniform vec4 uOutputTexture;
    void main(void) {
        vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
        position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
        position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
        gl_Position = vec4(position, 0.0, 1.0);
        vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
    }
`;

// Melt shader: heat distortion + downward drip + fade out
const MELT_FRAG = `
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D uTexture;
    uniform float uTime;
    uniform float uMeltAmount;

    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }

    void main(void) {
        vec2 uv = vTextureCoord;

        // Heat distortion
        float distortion = sin(uv.y * 15.0 + uTime * 8.0) * 0.02 * uMeltAmount;
        uv.x += distortion;

        // Downward drip
        float meltOffset = random(vec2(uv.x, 0.0)) * uMeltAmount * 0.8;
        uv.y -= meltOffset;

        vec4 baseColor = texture2D(uTexture, uv);

        // Orange heat tint
        float tintStrength = uMeltAmount * 0.6;
        baseColor.rgb = mix(baseColor.rgb, vec3(1.0, 0.4, 0.0), tintStrength);

        // Fade out fast
        baseColor.a *= 1.0 - smoothstep(0.1, 0.7, uMeltAmount);

        gl_FragColor = baseColor;
    }
`;

// Palette-swap shader: remaps puddle sprite luminance to 3 AI colors
const PUDDLE_FRAG = `
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D uTexture;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    void main(void) {
        vec4 tex = texture2D(uTexture, vTextureCoord);
        float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
        vec3 color;
        if (lum < 0.4) color = mix(uColor1, uColor2, lum / 0.4);
        else color = mix(uColor2, uColor3, (lum - 0.4) / 0.6);
        gl_FragColor = vec4(color * tex.a, tex.a);
    }
`;

const DRAGON_TEX_H = 672;     // native pixel height of dragon sprite frames
const ANIM_SPEED = 0.2;
const FLY_SPEED = 0.005;
const MELT_SPEED = 0.012;     // melt progress increment per tick — ~1.4s total dissolve at 60fps
const SETTLE_FRAMES = 90;     // idle-frame hold after the flame sequence ends (~1.5s at 60fps).
                              // Total settling wall-clock is longer because the flame animation
                              // (20 frames × ANIM_SPEED 0.2) must finish before the counter starts.

// Layout ratios and reference dimensions
const LAYOUT_REF_WIDTH = 900; // canvas width at which dragon renders at full scale
const DRAGON_MAX_SCALE = 0.7; // caps dragon scale on narrow viewports relative to LAYOUT_REF_WIDTH
const DRAGON_REST_X = 0.38;   // dragon rests at 38% width (leaves right side for artifact)
const DRAGON_Y = 0.55;
const IMAGE_X = 0.65;
const IMAGE_Y = 0.45;
const PUDDLE_Y = 0.88;
const FLY_OFFSCREEN_PAD = 200; // px beyond canvas right edge where dragon starts fly-in
const PUDDLE_SPRITE_W = 885;   // native pixel width of puddle sprite frames
const PUDDLE_WIDTH_RATIO = 0.3; // puddle renders at 30% of canvas width

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hexToInt(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

function intToVec3(c: number): [number, number, number] {
  return [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255];
}

function ensureBright(color: number): number {
  let r = (color >> 16) & 0xff;
  let g = (color >> 8) & 0xff;
  let b = color & 0xff;
  const lum = (r * 0.299 + g * 0.587 + b * 0.114);
  if (lum < 80) {
    const boost = 80 / Math.max(lum, 1);
    r = Math.min(255, Math.round(r * boost + 40));
    g = Math.min(255, Math.round(g * boost + 40));
    b = Math.min(255, Math.round(b * boost + 40));
  }
  return (r << 16) | (g << 8) | b;
}

interface PixiState {
  app: PIXI.Application;
  dragon: PIXI.AnimatedSprite;
  puddle: PIXI.AnimatedSprite;
  textures: {
    fly: PIXI.Texture[];
    land: PIXI.Texture[];
    idle: PIXI.Texture[];
    flame: PIXI.Texture[];
    puddleTex: PIXI.Texture[];
  };
}

export const SmelterCanvas = forwardRef<SmelterCanvasHandle, SmelterCanvasProps>(
  ({ onComplete, onFlyInStart, onFireStart }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const ps = useRef<PixiState | null>(null);
    const spriteRef = useRef<PIXI.Sprite | null>(null);
    const meltFilterRef = useRef<PIXI.Filter | null>(null);
    const puddleFilterRef = useRef<PIXI.Filter | null>(null);
    const phaseRef = useRef<AnimPhase>('empty');
    const meltProgressRef = useRef(0);
    const flyProgressRef = useRef(0);
    const settleProgressRef = useRef(0);
    const cbRef = useRef({ onComplete, onFlyInStart, onFireStart });
    const readyResolveRef = useRef<() => void>(undefined);
    const readyRejectRef = useRef<(err: unknown) => void>(undefined);
    const readyPromiseRef = useRef<Promise<void>>(new Promise(() => {}));

    useEffect(() => {
      cbRef.current = { onComplete, onFlyInStart, onFireStart };
    }, [onComplete, onFlyInStart, onFireStart]);

    const beginSequence = () => {
      if (!ps.current || !spriteRef.current) return;
      const { dragon, puddle } = ps.current;

      // Reset image
      spriteRef.current.visible = true;
      spriteRef.current.alpha = 1;
      spriteRef.current.tint = 0xffffff;
      spriteRef.current.filters = [];

      // Hide puddle
      puddle.visible = false;
      puddle.filters = [];

      phaseRef.current = 'flying_in';
      flyProgressRef.current = 0;
      meltProgressRef.current = 0;
      settleProgressRef.current = 0;
      dragon.visible = true;

      cbRef.current.onFlyInStart?.();
    };

    useImperativeHandle(ref, () => ({
      loadAndSmelt: async (imageUrl, subjectBox, colors) => {
        await readyPromiseRef.current;
        const state = ps.current!;

        // Destroy old filters before creating new ones (GPU memory)
        if (puddleFilterRef.current) { puddleFilterRef.current.destroy(); puddleFilterRef.current = null; }
        if (meltFilterRef.current) { meltFilterRef.current.destroy(); meltFilterRef.current = null; }

        // Pick top 3 dominant colors for puddle
        const palette = getFiveDistinctColors(colors);
        const picked = palette.slice(0, Math.min(3, palette.length)).map(h => ensureBright(hexToInt(h)));
        while (picked.length < 3) picked.push(picked[0] ?? 0xcccccc);

        // Create puddle palette-swap filter. Failure is fatal — the filters
        // ARE the animation, and a silent degrade would ship a broken smelt.
        puddleFilterRef.current = PIXI.Filter.from({
          gl: { vertex: FILTER_VERT, fragment: PUDDLE_FRAG },
          resources: {
            puddleUniforms: {
              uColor1: { value: intToVec3(picked[0]), type: 'vec3<f32>' },
              uColor2: { value: intToVec3(picked[1]), type: 'vec3<f32>' },
              uColor3: { value: intToVec3(picked[2]), type: 'vec3<f32>' },
            },
          },
        });

        // Create melt filter for image dissolution. Also fatal on failure.
        meltFilterRef.current = PIXI.Filter.from({
          gl: { vertex: FILTER_VERT, fragment: MELT_FRAG },
          resources: {
            meltUniforms: {
              uTime: { value: 0, type: 'f32' },
              uMeltAmount: { value: 0, type: 'f32' },
            },
          },
        });

        // Load image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = imageUrl;
        });

        // Crop via PixiJS frame Rectangle
        const baseTex = PIXI.Texture.from(img);
        let texture = baseTex;
        if (subjectBox?.length === 4) {
          const [ymin, xmin, ymax, xmax] = subjectBox;
          const cx = Math.max(0, Math.round((xmin / 1000) * img.width));
          const cy = Math.max(0, Math.round((ymin / 1000) * img.height));
          const cw = Math.min(img.width - cx, Math.round(((xmax - xmin) / 1000) * img.width));
          const ch = Math.min(img.height - cy, Math.round(((ymax - ymin) / 1000) * img.height));
          if (cw > 0 && ch > 0) {
            texture = new PIXI.Texture({
              source: baseTex.source,
              frame: new PIXI.Rectangle(cx, cy, cw, ch),
            });
            // baseTex is no longer needed; remove it from the PIXI cache without
            // destroying the source (which is still owned by the cropped texture)
            baseTex.destroy(false);
          }
        }

        if (spriteRef.current) {
          spriteRef.current.removeFromParent();
          spriteRef.current.texture.destroy(true);
          spriteRef.current = null;
        }

        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        spriteRef.current = sprite;

        // Image behind puddle and dragon
        state.app.stage.addChildAt(sprite, 0);

        beginSequence();
      },

      replay: () => {
        // Reset melt filter uniforms
        if (meltFilterRef.current) {
          try {
            const u = (meltFilterRef.current.resources as any).meltUniforms.uniforms;
            u.uMeltAmount = 0;
            u.uTime = 0;
          } catch (err) {
            console.error('[SmelterCanvas] replay: failed to reset melt filter uniforms:', err);
          }
        }
        beginSequence();
      },
    }));

    useEffect(() => {
      let destroyed = false;
      readyPromiseRef.current = new Promise<void>((resolve, reject) => {
        readyResolveRef.current = resolve;
        readyRejectRef.current = reject;
      });

      const initPixi = async () => {
        if (!containerRef.current || destroyed) return;

        const app = new PIXI.Application();
        await app.init({
          resizeTo: containerRef.current,
          backgroundAlpha: 0,
          antialias: true,
        });
        if (destroyed) { app.destroy(); return; }
        containerRef.current.appendChild(app.canvas);

        const dragonPaths = {
          fly: Array.from({ length: 8 }, (_, i) =>
            `/assets/dragon/__dragon_01_blue_flying_${i.toString().padStart(3, '0')}.png`),
          land: Array.from({ length: 12 }, (_, i) =>
            `/assets/dragon/__dragon_01_blue_land_${i.toString().padStart(3, '0')}.png`),
          idle: Array.from({ length: 20 }, (_, i) =>
            `/assets/dragon/__dragon_01_blue_idle_standing_${i.toString().padStart(3, '0')}.png`),
          flame: Array.from({ length: 20 }, (_, i) =>
            `/assets/dragon/__dragon_01_blue_standing_flame_with_flame_${i.toString().padStart(3, '0')}.png`),
        };
        const puddlePaths = Array.from({ length: 8 }, (_, i) =>
          `/assets/liquid/bubbling-puddle/p${i + 1}.png`);

        const allPaths = [...dragonPaths.fly, ...dragonPaths.land, ...dragonPaths.idle, ...dragonPaths.flame, ...puddlePaths];
        await PIXI.Assets.load(allPaths);
        if (destroyed) { app.destroy(); return; }

        const missing = allPaths.filter(p => !PIXI.Assets.get(p));
        if (missing.length > 0) {
          throw new Error(`[SmelterCanvas] ${missing.length} sprite(s) failed to load: ${missing.join(', ')}`);
        }

        const textures = {
          fly: dragonPaths.fly.map(f => PIXI.Assets.get(f)),
          land: dragonPaths.land.map(f => PIXI.Assets.get(f)),
          idle: dragonPaths.idle.map(f => PIXI.Assets.get(f)),
          flame: dragonPaths.flame.map(f => PIXI.Assets.get(f)),
          puddleTex: puddlePaths.map(f => PIXI.Assets.get(f)),
        };

        const puddle = new PIXI.AnimatedSprite(textures.puddleTex);
        puddle.animationSpeed = 0.05;
        puddle.anchor.set(0.5, 0.5);
        puddle.visible = false;
        puddle.loop = true;

        const dragon = new PIXI.AnimatedSprite(textures.idle);
        dragon.animationSpeed = ANIM_SPEED;
        dragon.anchor.set(0.5);
        dragon.visible = false;
        dragon.loop = true;
        dragon.play();

        // Z-order: puddle(1) → dragon(2). Image sprite inserted at index 0 in loadAndSmelt, placing it behind both.
        app.stage.addChild(puddle);
        app.stage.addChild(dragon);

        ps.current = { app, dragon, puddle, textures };

        const setDragonTex = (tex: PIXI.Texture[], loop: boolean) => {
          if (dragon.textures !== tex) {
            dragon.textures = tex;
            dragon.loop = loop;
            dragon.animationSpeed = ANIM_SPEED;
            dragon.gotoAndPlay(0);
          }
          if (!dragon.playing) dragon.play();
        };

        let time = 0;
        let consecutiveTickerErrors = 0;
        const MAX_CONSECUTIVE_TICKER_ERRORS = 5;

        const tickerFn = (ticker: PIXI.Ticker) => {
          try {
            time += 0.05 * ticker.deltaTime;
            const { width, height } = app.screen;
            const baseScale = Math.min(DRAGON_MAX_SCALE, (width / LAYOUT_REF_WIDTH) * DRAGON_MAX_SCALE);
            const dragonRestX = width * DRAGON_REST_X;
            const dragonY = height * DRAGON_Y;
            const imageX = width * IMAGE_X;
            const imageY = height * IMAGE_Y;
            const puddleY = height * PUDDLE_Y;

            switch (phaseRef.current) {
              case 'empty': {
                dragon.visible = true;
                setDragonTex(textures.idle, true);
                dragon.x = dragonRestX;
                dragon.y = dragonY;
                dragon.scale.set(-baseScale, baseScale);
                break;
              }

              case 'flying_in': {
                dragon.visible = true;
                setDragonTex(textures.fly, true);
                flyProgressRef.current += FLY_SPEED * ticker.deltaTime;
                const t = Math.min(flyProgressRef.current, 1);
                const eased = 1 - Math.pow(1 - t, 3);
                dragon.x = (width + FLY_OFFSCREEN_PAD) + (dragonRestX - width - FLY_OFFSCREEN_PAD) * eased;
                dragon.y = dragonY;
                dragon.scale.set(baseScale);
                if (t >= 1) {
                  phaseRef.current = 'landing';
                  setDragonTex(textures.land, false);
                  dragon.scale.set(-baseScale, baseScale);
                  dragon.x = dragonRestX;
                }
                break;
              }

              case 'landing': {
                dragon.x = dragonRestX;
                dragon.y = dragonY;
                dragon.scale.set(-baseScale, baseScale);
                if (!dragon.playing) {
                  phaseRef.current = 'melting';
                  meltProgressRef.current = 0;
                  setDragonTex(textures.flame, false);

                  // Apply melt shader to image
                  if (spriteRef.current && meltFilterRef.current) {
                    spriteRef.current.filters = [meltFilterRef.current];
                  }

                  cbRef.current.onFireStart?.();
                }
                break;
              }

              case 'melting': {
                dragon.x = dragonRestX;
                dragon.y = dragonY;
                dragon.scale.set(-baseScale, baseScale);

                if (!dragon.playing && dragon.textures === textures.flame) {
                  setDragonTex(textures.idle, true);
                }
                if (!dragon.playing) dragon.play();

                meltProgressRef.current += MELT_SPEED * ticker.deltaTime;
                const mp = Math.min(meltProgressRef.current, 1);

                // Advance melt shader on image
                if (meltFilterRef.current) {
                  const u = (meltFilterRef.current.resources as any).meltUniforms.uniforms;
                  u.uMeltAmount = mp;
                  u.uTime += 0.005 * ticker.deltaTime;
                }

                // Squish + hide image as it melts
                if (spriteRef.current) {
                  if (mp >= 0.85) {
                    spriteRef.current.visible = false;
                  } else {
                    const s = getImgScale(baseScale, spriteRef.current);
                    const squish = 1 - mp * 0.9; // 1.0 → 0.1
                    spriteRef.current.scale.x = s;
                    spriteRef.current.scale.y = s * squish;
                    spriteRef.current.x = imageX;
                    // Keep bottom edge fixed as it squishes down
                    const fullH = spriteRef.current.texture.height * s;
                    spriteRef.current.y = imageY + (fullH - fullH * squish) / 2;
                  }
                }

                // Puddle fades in
                const puddleAlpha = smoothstep(0.3, 0.6, mp);
                puddle.visible = puddleAlpha > 0.01;
                if (puddle.visible) {
                  if (!puddle.playing) puddle.play();
                  if (puddleFilterRef.current && !puddle.filters?.length) {
                    puddle.filters = [puddleFilterRef.current];
                  }
                  puddle.alpha = puddleAlpha;
                  puddle.x = imageX;
                  puddle.y = puddleY;
                  puddle.scale.set((width * PUDDLE_WIDTH_RATIO) / PUDDLE_SPRITE_W);
                }

                if (mp >= 1) {
                  phaseRef.current = 'settling';
                  settleProgressRef.current = 0;
                }
                break;
              }

              case 'settling': {
                // Let the dragon finish its flame animation and then play idle
                // for SETTLE_FRAMES before firing onComplete. This prevents the
                // post-smelt controls from appearing while the dragon is still
                // mid-fire or hasn't had time to stand down.
                dragon.x = dragonRestX;
                dragon.y = dragonY;
                dragon.scale.set(-baseScale, baseScale);

                if (!dragon.playing && dragon.textures === textures.flame) {
                  setDragonTex(textures.idle, true);
                }
                if (!dragon.playing) dragon.play();

                if (!puddle.playing) puddle.play();
                puddle.x = imageX;
                puddle.y = puddleY;
                puddle.scale.set((width * PUDDLE_WIDTH_RATIO) / PUDDLE_SPRITE_W);

                // Only start counting idle frames once the dragon has actually
                // switched back to idle (flame sequence finished).
                if (dragon.textures === textures.idle) {
                  settleProgressRef.current += ticker.deltaTime;
                  if (settleProgressRef.current >= SETTLE_FRAMES) {
                    phaseRef.current = 'complete';
                    cbRef.current.onComplete();
                  }
                }
                break;
              }

              case 'complete': {
                dragon.x = dragonRestX;
                dragon.y = dragonY;
                dragon.scale.set(-baseScale, baseScale);
                setDragonTex(textures.idle, true);

                if (!puddle.playing) puddle.play();
                puddle.x = imageX;
                puddle.y = puddleY;
                puddle.scale.set((width * PUDDLE_WIDTH_RATIO) / PUDDLE_SPRITE_W);
                break;
              }
            }

            // Image positioning (pre-melt)
            if (
              spriteRef.current &&
              (phaseRef.current === 'flying_in' || phaseRef.current === 'landing')
            ) {
              spriteRef.current.x = imageX;
              spriteRef.current.y = imageY;
              spriteRef.current.scale.set(getImgScale(baseScale, spriteRef.current));
            }
            consecutiveTickerErrors = 0;
          } catch (err) {
            consecutiveTickerErrors++;
            console.error(
              `[SmelterCanvas] Ticker error (${consecutiveTickerErrors}/${MAX_CONSECUTIVE_TICKER_ERRORS}):`,
              err
            );
            if (consecutiveTickerErrors >= MAX_CONSECUTIVE_TICKER_ERRORS) {
              console.error('[SmelterCanvas] Ticker disabled after repeated failures.');
              app.ticker.remove(tickerFn);
            }
          }
        };
        app.ticker.add(tickerFn);

        readyResolveRef.current?.();
      };

      initPixi().catch((err) => {
        console.error('[SmelterCanvas] initPixi failed — PixiJS could not initialize:', err);
        readyRejectRef.current?.(err);
      });
      return () => {
        destroyed = true;
        ps.current?.app.destroy(true, { children: true, texture: true });
        ps.current = null;
      };
    }, []);

    return <div ref={containerRef} className="absolute inset-0 overflow-hidden" aria-hidden="true" />;
  },
);

SmelterCanvas.displayName = 'SmelterCanvas';

function getImgScale(baseScale: number, sprite: PIXI.Sprite): number {
  const dragonVisualH = DRAGON_TEX_H * baseScale;
  const target = dragonVisualH * 0.6;
  const max = Math.max(sprite.texture.width, sprite.texture.height);
  return max > 0 ? target / max : 1;
}
