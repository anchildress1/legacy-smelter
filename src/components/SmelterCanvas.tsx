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

type AnimPhase = 'empty' | 'flying_in' | 'landing' | 'melting' | 'complete';

const DRAGON_TEX_H = 672;
const ANIM_SPEED = 0.2;
const FLY_SPEED = 0.005;  // ~3.3s
const MELT_SPEED = 0.0025; // ~6.7s — slow burn

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function hexToInt(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

interface PixiState {
  app: PIXI.Application;
  dragon: PIXI.AnimatedSprite;
  gooStream: PIXI.AnimatedSprite;
  puddle: PIXI.AnimatedSprite;
  puddleBase: PIXI.Graphics;
  burnMask: PIXI.Graphics;
  textures: {
    fly: PIXI.Texture[];
    land: PIXI.Texture[];
    idle: PIXI.Texture[];
    flame: PIXI.Texture[];
    goo: PIXI.Texture[];
    puddleTex: PIXI.Texture[];
  };
}

export const SmelterCanvas = forwardRef<SmelterCanvasHandle, SmelterCanvasProps>(
  ({ onComplete, onFlyInStart, onFireStart }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const ps = useRef<PixiState | null>(null);
    const spriteRef = useRef<PIXI.Sprite | null>(null);
    const phaseRef = useRef<AnimPhase>('empty');
    const meltProgressRef = useRef(0);
    const flyProgressRef = useRef(0);
    const meltColorsRef = useRef<number[]>([0x888888, 0x888888, 0x888888]);
    const cbRef = useRef({ onComplete, onFlyInStart, onFireStart });
    const readyResolveRef = useRef<() => void>(undefined);
    const readyPromiseRef = useRef<Promise<void>>(new Promise(() => {}));

    useEffect(() => {
      cbRef.current = { onComplete, onFlyInStart, onFireStart };
    }, [onComplete, onFlyInStart, onFireStart]);

    /** Reset all melt visuals and start the fly-in sequence */
    const beginSequence = () => {
      if (!ps.current || !spriteRef.current) return;
      const { dragon, gooStream, puddle, puddleBase, burnMask } = ps.current;

      // Reset image sprite
      spriteRef.current.visible = true;
      spriteRef.current.alpha = 1;
      spriteRef.current.tint = 0xffffff;
      spriteRef.current.mask = null;
      spriteRef.current.filters = [];

      // Hide liquid sprites
      gooStream.visible = false;
      puddle.visible = false;
      puddleBase.visible = false;
      puddleBase.clear();
      burnMask.clear();

      phaseRef.current = 'flying_in';
      flyProgressRef.current = 0;
      meltProgressRef.current = 0;
      dragon.visible = true;

      cbRef.current.onFlyInStart?.();
    };

    useImperativeHandle(ref, () => ({
      loadAndSmelt: async (imageUrl, subjectBox, colors) => {
        await readyPromiseRef.current;
        const state = ps.current!;

        // Pick 3 random colors from AI palette for liquid tinting
        const palette = getFiveDistinctColors(colors);
        const shuffled = [...palette].sort(() => Math.random() - 0.5);
        meltColorsRef.current = shuffled.slice(0, 3).map(hexToInt);

        // Load the image
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = reject;
          img.src = imageUrl;
        });

        // Create texture — crop via PixiJS frame Rectangle
        const baseTex = PIXI.Texture.from(img);
        let texture = baseTex;
        if (subjectBox && subjectBox.length === 4) {
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
          }
        }

        // Remove old sprite
        if (spriteRef.current) {
          state.app.stage.removeChild(spriteRef.current);
          spriteRef.current = null;
        }

        // Create image sprite
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        spriteRef.current = sprite;

        // Insert at index 0 (behind everything)
        state.app.stage.addChildAt(sprite, 0);

        if (import.meta.env.DEV) {
          console.log('[SmelterCanvas] Image loaded:', texture.width, 'x', texture.height,
            subjectBox ? '(cropped)' : '(full)');
        }

        beginSequence();
      },

      replay: () => {
        beginSequence();
      },
    }));

    // Single init effect
    useEffect(() => {
      let destroyed = false;
      readyPromiseRef.current = new Promise<void>(r => { readyResolveRef.current = r; });

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

        // Dragon frame paths
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

        // Liquid frame paths
        const gooPaths = Array.from({ length: 8 }, (_, i) =>
          `/assets/liquid/goo-tiles/g${i + 1}.png`);
        const puddlePaths = Array.from({ length: 8 }, (_, i) =>
          `/assets/liquid/bubbling-puddle/p${i + 1}.png`);

        await PIXI.Assets.load([
          ...dragonPaths.fly, ...dragonPaths.land, ...dragonPaths.idle, ...dragonPaths.flame,
          ...gooPaths, ...puddlePaths,
        ]);
        if (destroyed) { app.destroy(); return; }

        const textures = {
          fly: dragonPaths.fly.map(f => PIXI.Assets.get(f)),
          land: dragonPaths.land.map(f => PIXI.Assets.get(f)),
          idle: dragonPaths.idle.map(f => PIXI.Assets.get(f)),
          flame: dragonPaths.flame.map(f => PIXI.Assets.get(f)),
          goo: gooPaths.map(f => PIXI.Assets.get(f)),
          puddleTex: puddlePaths.map(f => PIXI.Assets.get(f)),
        };

        // --- Create display objects ---

        // Burn mask (Graphics for left-to-right image wipe)
        const burnMask = new PIXI.Graphics();
        burnMask.label = 'burnMask';

        // Goo stream — vertical liquid flow, hidden initially
        const gooStream = new PIXI.AnimatedSprite(textures.goo);
        gooStream.animationSpeed = ANIM_SPEED;
        gooStream.anchor.set(0.5, 0);
        gooStream.visible = false;
        gooStream.loop = true;

        // Puddle color base — 3 overlapping colored ellipses
        const puddleBase = new PIXI.Graphics();
        puddleBase.visible = false;

        // Bubbling puddle — surface detail layer (bubbles/ripples), hidden initially
        const puddle = new PIXI.AnimatedSprite(textures.puddleTex);
        puddle.animationSpeed = ANIM_SPEED;
        puddle.anchor.set(0.5, 0.5);
        puddle.visible = false;
        puddle.loop = true;

        // Dragon
        const dragon = new PIXI.AnimatedSprite(textures.idle);
        dragon.animationSpeed = ANIM_SPEED;
        dragon.anchor.set(0.5);
        dragon.visible = false;
        dragon.loop = true;
        dragon.play();

        // Z-order: [image@0 later] → burnMask → gooStream → puddleBase → puddle → dragon
        app.stage.addChild(burnMask);
        app.stage.addChild(gooStream);
        app.stage.addChild(puddleBase);
        app.stage.addChild(puddle);
        app.stage.addChild(dragon);

        ps.current = { app, dragon, gooStream, puddle, puddleBase, burnMask, textures };

        /** Swap dragon textures and guarantee it keeps playing */
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

        app.ticker.add((ticker) => {
          try {
            time += 0.05 * ticker.deltaTime;
            const { width, height } = app.screen;
            const baseScale = Math.min(0.7, (width / 900) * 0.7);
            const dragonRestX = width * 0.25;
            const dragonY = height * 0.55;
            const imageX = width * 0.72;
            const imageY = height * 0.5;
            const puddleY = height * 0.88;

            switch (phaseRef.current) {
              case 'empty':
                break;

              case 'flying_in': {
                dragon.visible = true;
                setDragonTex(textures.fly, true);

                flyProgressRef.current += FLY_SPEED * ticker.deltaTime;
                const t = Math.min(flyProgressRef.current, 1);
                const eased = 1 - Math.pow(1 - t, 3);
                dragon.x = (width + 200) + (dragonRestX - width - 200) * eased;
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
                  // Fire + melt start simultaneously
                  phaseRef.current = 'melting';
                  meltProgressRef.current = 0;
                  setDragonTex(textures.flame, false);

                  // Tint goo stream with first AI color
                  gooStream.tint = meltColorsRef.current[0];

                  cbRef.current.onFireStart?.();
                }
                break;
              }

              case 'melting': {
                dragon.x = dragonRestX;
                dragon.y = dragonY;
                dragon.scale.set(-baseScale, baseScale);

                // When flame finishes, return to idle (melt continues)
                if (!dragon.playing && dragon.textures === textures.flame) {
                  setDragonTex(textures.idle, true);
                }
                if (!dragon.playing) dragon.play();

                meltProgressRef.current += MELT_SPEED * ticker.deltaTime;
                const mp = Math.min(meltProgressRef.current, 1);

                // --- Image fade: slow alpha dissolve + orange tint + drift ---
                const fadeAmount = smoothstep(0, 0.6, mp);
                if (spriteRef.current) {
                  if (fadeAmount < 0.99) {
                    const s = getImgScale(baseScale, spriteRef.current);
                    spriteRef.current.alpha = 1 - fadeAmount;
                    const tintG = Math.round(255 - fadeAmount * 155);
                    const tintB = Math.round(255 - fadeAmount * 255);
                    spriteRef.current.tint = (0xff << 16) | (tintG << 8) | tintB;
                    spriteRef.current.x = imageX;
                    spriteRef.current.y = imageY + fadeAmount * 40;
                    spriteRef.current.scale.set(s);
                  } else {
                    spriteRef.current.visible = false;
                  }
                }

                // --- Goo stream: starts with fire, fades out later ---
                const gooAlpha = smoothstep(0.05, 0.25, mp) * (1 - smoothstep(0.55, 0.8, mp));
                gooStream.visible = gooAlpha > 0.01;
                if (gooStream.visible) {
                  if (!gooStream.playing) gooStream.play();
                  gooStream.alpha = gooAlpha;

                  const imgS = spriteRef.current
                    ? getImgScale(baseScale, spriteRef.current) : baseScale * 0.3;
                  const imgH = spriteRef.current
                    ? spriteRef.current.texture.height * imgS : 100;
                  const streamTop = imageY + imgH / 2;
                  const streamHeight = puddleY - streamTop;
                  const streamScaleY = Math.max(streamHeight / 512, 0.1);
                  const streamScaleX = streamScaleY * 0.4;

                  gooStream.x = imageX;
                  gooStream.y = streamTop;
                  gooStream.scale.set(streamScaleX, streamScaleY);
                }

                // --- Puddle: 3-color Graphics base + animated sprite overlay ---
                const puddleAlpha = smoothstep(0.25, 0.5, mp);
                const puddleTargetW = width * 0.3;
                const puddleScale = puddleTargetW / 885;
                const pw = puddleTargetW;
                const ph = 170 * puddleScale;
                const [pc1, pc2, pc3] = meltColorsRef.current;

                // Color base: 3 overlapping ellipses
                puddleBase.visible = puddleAlpha > 0.01;
                if (puddleBase.visible) {
                  puddleBase.clear();
                  puddleBase.alpha = puddleAlpha;
                  puddleBase.ellipse(imageX - pw * 0.12, puddleY, pw * 0.42, ph * 0.9);
                  puddleBase.fill({ color: pc1, alpha: 0.8 });
                  puddleBase.ellipse(imageX + pw * 0.05, puddleY + 2, pw * 0.48, ph);
                  puddleBase.fill({ color: pc2, alpha: 0.7 });
                  puddleBase.ellipse(imageX + pw * 0.18, puddleY - 2, pw * 0.38, ph * 0.85);
                  puddleBase.fill({ color: pc3, alpha: 0.75 });
                }

                // Animated texture overlay for surface detail
                puddle.visible = puddleAlpha > 0.01;
                if (puddle.visible) {
                  if (!puddle.playing) puddle.play();
                  puddle.alpha = puddleAlpha * 0.35;
                  puddle.tint = 0xffffff;
                  puddle.x = imageX;
                  puddle.y = puddleY;
                  puddle.scale.set(puddleScale);
                }

                if (mp >= 1) {
                  phaseRef.current = 'complete';
                  gooStream.visible = false;
                  cbRef.current.onComplete();
                }
                break;
              }

              case 'complete': {
                dragon.x = dragonRestX;
                dragon.y = dragonY;
                dragon.scale.set(-baseScale, baseScale);
                if (!dragon.playing) dragon.play();

                // Puddle: keep base + overlay alive
                const cpw = width * 0.3;
                const cps = cpw / 885;
                const cph = 170 * cps;
                const [cc1, cc2, cc3] = meltColorsRef.current;

                puddleBase.clear();
                puddleBase.ellipse(imageX - cpw * 0.12, puddleY, cpw * 0.42, cph * 0.9);
                puddleBase.fill({ color: cc1, alpha: 0.8 });
                puddleBase.ellipse(imageX + cpw * 0.05, puddleY + 2, cpw * 0.48, cph);
                puddleBase.fill({ color: cc2, alpha: 0.7 });
                puddleBase.ellipse(imageX + cpw * 0.18, puddleY - 2, cpw * 0.38, cph * 0.85);
                puddleBase.fill({ color: cc3, alpha: 0.75 });

                if (!puddle.playing) puddle.play();
                puddle.x = imageX;
                puddle.y = puddleY;
                puddle.scale.set(cps);
                break;
              }
            }

            // Image positioning (pre-melt phases)
            if (
              spriteRef.current &&
              (phaseRef.current === 'flying_in' || phaseRef.current === 'landing')
            ) {
              spriteRef.current.x = imageX;
              spriteRef.current.y = imageY;
              spriteRef.current.scale.set(getImgScale(baseScale, spriteRef.current));
            }
          } catch (err) {
            console.error('[SmelterCanvas] Ticker error:', err);
          }
        });

        readyResolveRef.current?.();
      };

      initPixi();
      return () => {
        destroyed = true;
        ps.current?.app.destroy(true, { children: true, texture: true });
        ps.current = null;
      };
    }, []);

    return <div ref={containerRef} className="absolute inset-0 overflow-hidden" />;
  },
);

SmelterCanvas.displayName = 'SmelterCanvas';

/** Scale image to ~60% of dragon's visual height */
function getImgScale(baseScale: number, sprite: PIXI.Sprite): number {
  const dragonVisualH = DRAGON_TEX_H * baseScale;
  const target = dragonVisualH * 0.6;
  const max = Math.max(sprite.texture.width, sprite.texture.height);
  return max > 0 ? target / max : 1;
}
