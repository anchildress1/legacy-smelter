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

type AnimPhase = 'empty' | 'flying_in' | 'landing' | 'fire_breathing' | 'complete';

const VERT_SHADER = `
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

const MELT_SHADER = `
    precision highp float;
    varying vec2 vTextureCoord;
    uniform sampler2D uTexture;
    uniform float uTime;
    uniform float uMeltAmount;
    uniform vec3 uColor1;
    uniform vec3 uColor2;
    uniform vec3 uColor3;
    uniform vec3 uColor4;
    uniform vec3 uColor5;

    float random(vec2 st) {
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
    }
    vec2 hash2(vec2 p) {
        return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
    }
    float voronoi(vec2 x) {
        vec2 n = floor(x);
        vec2 f = fract(x);
        float m = 8.0;
        for(int j=-1; j<=1; j++) {
            for(int i=-1; i<=1; i++) {
                vec2 g = vec2(float(i), float(j));
                vec2 o = hash2(n + g);
                vec2 r = g + o - f;
                float d = dot(r, r);
                if(d < m) m = d;
            }
        }
        return sqrt(m);
    }

    void main(void) {
        vec2 uv = vTextureCoord;
        float distortion = sin(uv.y * 15.0 + uTime * 8.0) * 0.02 * uMeltAmount;
        uv.x += distortion;
        float meltOffset = random(vec2(uv.x, 0.0)) * uMeltAmount * 0.8;
        uv.y -= meltOffset;
        vec4 baseColor = texture2D(uTexture, uv);
        if (uMeltAmount > 0.3) {
            float v = voronoi(uv * 5.0 + uTime * 0.5);
            float marble = sin(v * 10.0 + uTime) * 0.5 + 0.5;
            vec3 puddleColor;
            float m5 = marble * 5.0;
            if (m5 < 1.0) puddleColor = mix(uColor1, uColor2, m5);
            else if (m5 < 2.0) puddleColor = mix(uColor2, uColor3, m5 - 1.0);
            else if (m5 < 3.0) puddleColor = mix(uColor3, uColor4, m5 - 2.0);
            else if (m5 < 4.0) puddleColor = mix(uColor4, uColor5, m5 - 3.0);
            else puddleColor = mix(uColor5, uColor1, m5 - 4.0);
            float blend = smoothstep(0.3, 0.8, uMeltAmount);
            baseColor.rgb = mix(baseColor.rgb, puddleColor, blend);
            baseColor.a = max(baseColor.a, blend);
            float glowFade = 1.0 - smoothstep(0.7, 1.0, uMeltAmount);
            baseColor.rgb += vec3(1.0, 0.3, 0.0) * (1.0 - v) * uMeltAmount * 0.4 * glowFade;
        }
        gl_FragColor = baseColor;
    }
`;

const DRAGON_TEX_H = 672;
const ANIM_SPEED = 0.2;
const FLY_SPEED = 0.007;
const MELT_SPEED = 0.005;

interface PixiState {
  app: PIXI.Application;
  dragon: PIXI.AnimatedSprite;
  textures: {
    fly: PIXI.Texture[];
    land: PIXI.Texture[];
    idle: PIXI.Texture[];
    flame: PIXI.Texture[];
  };
}

export const SmelterCanvas = forwardRef<SmelterCanvasHandle, SmelterCanvasProps>(
  ({ onComplete, onFlyInStart, onFireStart }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const ps = useRef<PixiState | null>(null);
    const spriteRef = useRef<PIXI.Sprite | null>(null);
    const filterRef = useRef<PIXI.Filter | null>(null);
    const phaseRef = useRef<AnimPhase>('empty');
    const meltAmountRef = useRef(0);
    const flyProgressRef = useRef(0);
    const cbRef = useRef({ onComplete, onFlyInStart, onFireStart });
    const readyResolveRef = useRef<() => void>(undefined);
    const readyPromiseRef = useRef<Promise<void>>(new Promise(() => {}));

    useEffect(() => {
      cbRef.current = { onComplete, onFlyInStart, onFireStart };
    }, [onComplete, onFlyInStart, onFireStart]);

    const hexToVec3 = (hex: string): [number, number, number] => [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];

    /** Start or restart the fly-in → land → fire → melt sequence */
    const beginSequence = () => {
      if (!ps.current || !spriteRef.current) return;
      // Remove filter for clean image display during fly-in
      spriteRef.current.filters = [];
      phaseRef.current = 'flying_in';
      flyProgressRef.current = 0;
      meltAmountRef.current = 0;
      ps.current.dragon.visible = true;
      cbRef.current.onFlyInStart?.();
    };

    useImperativeHandle(ref, () => ({
      loadAndSmelt: async (imageUrl, subjectBox, colors) => {
        await readyPromiseRef.current;
        const state = ps.current!;

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

        // Create image sprite — no filter yet
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 0.5);
        spriteRef.current = sprite;

        // Insert behind dragon (index 0)
        state.app.stage.addChildAt(sprite, 0);

        // Pre-create the melt filter NOW (not in the ticker)
        // uMeltAmount starts at 0 so it's a pass-through until fire_breathing
        try {
          const c = getFiveDistinctColors(colors);
          const filter = PIXI.Filter.from({
            gl: { vertex: VERT_SHADER, fragment: MELT_SHADER },
            resources: {
              meltUniforms: {
                uTime: { value: 0, type: 'f32' },
                uMeltAmount: { value: 0, type: 'f32' },
                uColor1: { value: hexToVec3(c[0]), type: 'vec3<f32>' },
                uColor2: { value: hexToVec3(c[1]), type: 'vec3<f32>' },
                uColor3: { value: hexToVec3(c[2]), type: 'vec3<f32>' },
                uColor4: { value: hexToVec3(c[3]), type: 'vec3<f32>' },
                uColor5: { value: hexToVec3(c[4]), type: 'vec3<f32>' },
              },
            },
          });
          filterRef.current = filter;
        } catch (err) {
          console.error('[SmelterCanvas] Filter creation failed:', err);
          filterRef.current = null;
        }

        if (import.meta.env.DEV) {
          console.log('[SmelterCanvas] Image loaded:', texture.width, 'x', texture.height,
            subjectBox ? '(cropped)' : '(full)',
            'filter:', filterRef.current ? 'ok' : 'FAILED');
        }

        beginSequence();
      },

      replay: () => {
        // Reset filter uniforms for re-use
        if (filterRef.current) {
          try {
            const u = (filterRef.current.resources as any).meltUniforms.uniforms;
            u.uMeltAmount.value = 0;
            u.uTime.value = 0;
          } catch { /* ignore */ }
        }
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

        const paths = {
          fly: Array.from({ length: 8 }, (_, i) =>
            `/assets/dragon/__dragon_01_blue_flying_${i.toString().padStart(3, '0')}.png`),
          land: Array.from({ length: 12 }, (_, i) =>
            `/assets/dragon/__dragon_01_blue_land_${i.toString().padStart(3, '0')}.png`),
          idle: Array.from({ length: 20 }, (_, i) =>
            `/assets/dragon/__dragon_01_blue_idle_standing_${i.toString().padStart(3, '0')}.png`),
          flame: Array.from({ length: 20 }, (_, i) =>
            `/assets/dragon/__dragon_01_blue_standing_flame_with_flame_${i.toString().padStart(3, '0')}.png`),
        };
        await PIXI.Assets.load([
          ...paths.fly, ...paths.land, ...paths.idle, ...paths.flame,
        ]);
        if (destroyed) { app.destroy(); return; }

        const textures = {
          fly: paths.fly.map(f => PIXI.Assets.get(f)),
          land: paths.land.map(f => PIXI.Assets.get(f)),
          idle: paths.idle.map(f => PIXI.Assets.get(f)),
          flame: paths.flame.map(f => PIXI.Assets.get(f)),
        };

        // Dragon — starts hidden, always animating
        const dragon = new PIXI.AnimatedSprite(textures.idle);
        dragon.animationSpeed = ANIM_SPEED;
        dragon.anchor.set(0.5);
        dragon.visible = false;
        dragon.loop = true;
        dragon.play();

        app.stage.addChild(dragon);
        ps.current = { app, dragon, textures };

        /** Swap textures and guarantee dragon keeps playing */
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
            // Dragon at 0.7 for desktop, scale down proportionally for smaller canvases
          // Never scale UP (causes pixelation)
          const baseScale = Math.min(0.7, (width / 900) * 0.7);
            const dragonRestX = width * 0.25;
            const dragonY = height * 0.55;
            const imageX = width * 0.72;
            const imageY = height * 0.5;

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
                dragon.scale.set(baseScale); // faces left naturally

                if (t >= 1) {
                  phaseRef.current = 'landing';
                  setDragonTex(textures.land, false);
                  dragon.scale.set(-baseScale, baseScale); // mirror: face right
                  dragon.x = dragonRestX;
                }
                break;
              }

              case 'landing': {
                dragon.x = dragonRestX;
                dragon.y = dragonY;
                dragon.scale.set(-baseScale, baseScale);

                // Transition when non-looping land animation finishes
                if (!dragon.playing) {
                  phaseRef.current = 'fire_breathing';
                  meltAmountRef.current = 0;
                  setDragonTex(textures.flame, true);

                  // Apply pre-created melt filter to image
                  if (spriteRef.current && filterRef.current) {
                    spriteRef.current.filters = [filterRef.current];
                  }

                  cbRef.current.onFireStart?.();
                }
                break;
              }

              case 'fire_breathing': {
                dragon.x = dragonRestX;
                dragon.y = dragonY;
                dragon.scale.set(-baseScale, baseScale);
                dragon.scale.y = baseScale * (1 + Math.sin(time * 5) * 0.05);
                if (!dragon.playing) dragon.play();

                // Advance melt
                meltAmountRef.current += MELT_SPEED * ticker.deltaTime;
                const melt = Math.min(meltAmountRef.current, 1);

                if (filterRef.current) {
                  const u = (filterRef.current.resources as any).meltUniforms.uniforms;
                  u.uMeltAmount.value = melt;
                  u.uTime.value += 0.005 * ticker.deltaTime;
                }

                // Squash image into puddle
                if (spriteRef.current) {
                  const squish = 1.0 - melt * 0.65;
                  const s = imgScale(baseScale, spriteRef.current);
                  spriteRef.current.scale.x = s;
                  spriteRef.current.scale.y = s * squish;
                  spriteRef.current.x = imageX;
                  const fullH = spriteRef.current.texture.height * s;
                  spriteRef.current.y = imageY + (fullH - fullH * squish) / 2;
                }

                if (melt >= 1) {
                  phaseRef.current = 'complete';
                  setDragonTex(textures.idle, true);
                  cbRef.current.onComplete();
                }
                break;
              }

              case 'complete': {
                dragon.x = dragonRestX;
                dragon.y = dragonY;
                dragon.scale.set(-baseScale, baseScale);
                if (!dragon.playing) dragon.play();

                // Keep puddle subtly animated
                if (filterRef.current) {
                  (filterRef.current.resources as any).meltUniforms.uniforms.uTime.value += 0.003 * ticker.deltaTime;
                }
                if (spriteRef.current) {
                  const s = imgScale(baseScale, spriteRef.current);
                  spriteRef.current.scale.x = s;
                  spriteRef.current.scale.y = s * 0.35;
                  spriteRef.current.x = imageX;
                  const fullH = spriteRef.current.texture.height * s;
                  spriteRef.current.y = imageY + (fullH - fullH * 0.35) / 2;
                }
                break;
              }
            }

            // Image positioning (pre-melt phases)
            if (spriteRef.current && phaseRef.current === 'flying_in') {
              spriteRef.current.x = imageX;
              spriteRef.current.y = imageY;
              spriteRef.current.scale.set(imgScale(baseScale, spriteRef.current));
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
function imgScale(baseScale: number, sprite: PIXI.Sprite): number {
  const dragonVisualH = DRAGON_TEX_H * baseScale;
  const target = dragonVisualH * 0.6;
  const max = Math.max(sprite.texture.width, sprite.texture.height);
  return max > 0 ? target / max : 1;
}
