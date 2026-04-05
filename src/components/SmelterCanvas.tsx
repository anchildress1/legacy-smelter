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

// Palette-swap shader: remaps puddle sprite luminance to 3 AI colors
const PUDDLE_VERT = `
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
        gl_FragColor = vec4(color, tex.a);
    }
`;

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

function intToVec3(c: number): [number, number, number] {
  return [((c >> 16) & 0xff) / 255, ((c >> 8) & 0xff) / 255, (c & 0xff) / 255];
}

/** Ensure a color is bright enough for the puddle (min luminance ~30%) */
function ensureBright(color: number): number {
  let r = (color >> 16) & 0xff;
  let g = (color >> 8) & 0xff;
  let b = color & 0xff;
  const lum = (r * 0.299 + g * 0.587 + b * 0.114);
  if (lum < 80) {
    // Boost toward a brighter version of the same hue
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
  gooStream: PIXI.AnimatedSprite;
  puddle: PIXI.AnimatedSprite;
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
    const puddleFilterRef = useRef<PIXI.Filter | null>(null);
    const cbRef = useRef({ onComplete, onFlyInStart, onFireStart });
    const readyResolveRef = useRef<() => void>(undefined);
    const readyPromiseRef = useRef<Promise<void>>(new Promise(() => {}));

    useEffect(() => {
      cbRef.current = { onComplete, onFlyInStart, onFireStart };
    }, [onComplete, onFlyInStart, onFireStart]);

    /** Reset all melt visuals and start the fly-in sequence */
    const beginSequence = () => {
      if (!ps.current || !spriteRef.current) return;
      const { dragon, gooStream, puddle } = ps.current;

      // Reset image sprite
      spriteRef.current.visible = true;
      spriteRef.current.alpha = 1;
      spriteRef.current.tint = 0xffffff;

      // Hide liquid sprites
      gooStream.visible = false;
      gooStream.filters = [];
      puddle.visible = false;
      puddle.filters = [];

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

        // Pick 3 colors from AI palette for puddle recoloring
        const palette = getFiveDistinctColors(colors);
        const shuffled = [...palette].sort(() => Math.random() - 0.5);
        const picked = shuffled.slice(0, Math.min(3, shuffled.length)).map(h => ensureBright(hexToInt(h)));
        // Pad to 3 if fewer available
        while (picked.length < 3) picked.push(picked[0] || 0xcccccc);
        meltColorsRef.current = picked;

        // Create puddle palette-swap filter
        try {
          puddleFilterRef.current = PIXI.Filter.from({
            gl: { vertex: PUDDLE_VERT, fragment: PUDDLE_FRAG },
            resources: {
              puddleUniforms: {
                uColor1: { value: intToVec3(picked[0]), type: 'vec3<f32>' },
                uColor2: { value: intToVec3(picked[1]), type: 'vec3<f32>' },
                uColor3: { value: intToVec3(picked[2]), type: 'vec3<f32>' },
              },
            },
          });
        } catch (err) {
          console.error('[SmelterCanvas] Puddle filter failed:', err);
          puddleFilterRef.current = null;
        }

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

        // Goo stream — vertical liquid flow, hidden initially
        const gooStream = new PIXI.AnimatedSprite(textures.goo);
        gooStream.animationSpeed = 0.12;
        gooStream.anchor.set(0.5, 0);
        gooStream.visible = false;
        gooStream.loop = true;

        // Bubbling puddle — recolored via palette-swap shader
        const puddle = new PIXI.AnimatedSprite(textures.puddleTex);
        puddle.animationSpeed = 0.03; // very slow pops
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

        // Z-order: [image@0 later] → gooStream → puddle → dragon
        app.stage.addChild(gooStream);
        app.stage.addChild(puddle);
        app.stage.addChild(dragon);

        ps.current = { app, dragon, gooStream, puddle, textures };

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

                  // Apply palette-swap shader to goo stream
                  if (puddleFilterRef.current) {
                    gooStream.filters = [puddleFilterRef.current];
                  }

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

                // --- Goo stream: solid pour, shrinks away top-to-bottom ---
                const pourStart = 0.05;
                const pourEnd = 0.75;
                const pourVisible = mp >= pourStart && mp < pourEnd;
                gooStream.visible = pourVisible;
                if (pourVisible) {
                  if (!gooStream.playing) gooStream.play();
                  gooStream.alpha = 1; // fully opaque, no overlay

                  const imgS = spriteRef.current
                    ? getImgScale(baseScale, spriteRef.current) : baseScale * 0.3;
                  const imgW = spriteRef.current
                    ? spriteRef.current.texture.width * imgS : 150;
                  const imgH = spriteRef.current
                    ? spriteRef.current.texture.height * imgS : 100;
                  const streamTop = imageY + imgH / 2;
                  const streamHeight = puddleY - streamTop;

                  // Stream shrinks from top as pour ends (anchor is at top)
                  const retract = smoothstep(0.5, 0.75, mp);
                  const visibleHeight = streamHeight * (1 - retract);
                  const streamScaleY = Math.max(visibleHeight / 512, 0.01);
                  const streamScaleX = Math.max(imgW * 0.7 / 320, 0.15);

                  gooStream.x = imageX;
                  gooStream.y = streamTop;
                  gooStream.scale.set(streamScaleX, streamScaleY);
                }

                // --- Puddle: sprite recolored via palette-swap shader ---
                const puddleAlpha = smoothstep(0.25, 0.5, mp);
                const puddleTargetW = width * 0.3;
                const puddleScale = puddleTargetW / 885;

                puddle.visible = puddleAlpha > 0.01;
                if (puddle.visible) {
                  if (!puddle.playing) puddle.play();
                  if (puddleFilterRef.current && !puddle.filters?.length) {
                    puddle.filters = [puddleFilterRef.current];
                  }
                  puddle.alpha = puddleAlpha;
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

                // Puddle persists
                if (!puddle.playing) puddle.play();
                const cps = (width * 0.3) / 885;
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
