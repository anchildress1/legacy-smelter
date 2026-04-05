import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { getFiveDistinctColors } from '../lib/utils';

interface SmelterCanvasProps {
  image: string | null;
  isMelting: boolean;
  onComplete: () => void;
  onFlyInStart?: () => void;
  onFireStart?: () => void;
  colors: string[];
  subjectBox: number[] | null;
}

type AnimPhase = 'waiting' | 'flying_in' | 'landing' | 'fire_breathing' | 'complete';

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

        // Heat distortion
        float distortion = sin(uv.y * 15.0 + uTime * 8.0) * 0.02 * uMeltAmount;
        uv.x += distortion;

        // Downward melting
        float meltOffset = random(vec2(uv.x, 0.0)) * uMeltAmount * 0.8;
        uv.y -= meltOffset;

        vec4 baseColor = texture2D(uTexture, uv);

        // Transition to marble puddle
        if (uMeltAmount > 0.3) {
            float v = voronoi(uv * 5.0 + uTime * 0.5);
            float marble = sin(v * 10.0 + uTime) * 0.5 + 0.5;

            // Smooth color blending between palette colors
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

            // Slag glow fades as melt completes, leaving clean puddle
            float glowFade = 1.0 - smoothstep(0.7, 1.0, uMeltAmount);
            baseColor.rgb += vec3(1.0, 0.3, 0.0) * (1.0 - v) * uMeltAmount * 0.4 * glowFade;
        }

        gl_FragColor = baseColor;
    }
`;

/** Calculate image scale capped to dragon visual height */
function getImageScale(
  sprite: PIXI.Sprite,
  dragon: PIXI.AnimatedSprite,
  baseScale: number,
  isMobile: boolean,
  canvasWidth: number,
): number {
  const dragonVisualHeight = dragon.texture.height * baseScale;
  const targetSize = Math.min(isMobile ? canvasWidth * 0.3 : canvasWidth * 0.25, dragonVisualHeight);
  const currentSize = Math.max(sprite.texture.width, sprite.texture.height);
  return currentSize > 0 ? targetSize / currentSize : 1;
}

export const SmelterCanvas: React.FC<SmelterCanvasProps> = ({
  image, isMelting, onComplete, onFlyInStart, onFireStart, colors, subjectBox,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const spriteRef = useRef<PIXI.Sprite | null>(null);
  const filterRef = useRef<PIXI.Filter | null>(null);
  const dragonRef = useRef<PIXI.AnimatedSprite | null>(null);
  const phaseRef = useRef<AnimPhase>('waiting');
  const meltAmountRef = useRef(0);
  const flyProgressRef = useRef(0);
  const isMeltingRef = useRef(isMelting);
  const cbRef = useRef({ onComplete, onFlyInStart, onFireStart });
  const texturesRef = useRef<{
    fly: PIXI.Texture[]; land: PIXI.Texture[];
    idle: PIXI.Texture[]; flame: PIXI.Texture[];
  } | null>(null);
  const [isReady, setIsReady] = useState(false);

  // Keep refs in sync with props
  useEffect(() => { isMeltingRef.current = isMelting; }, [isMelting]);
  useEffect(() => { cbRef.current = { onComplete, onFlyInStart, onFireStart }; },
    [onComplete, onFlyInStart, onFireStart]);

  const hexToVec3 = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  };

  /** Kick off the fly-in → land → fire sequence */
  const startSequence = () => {
    if (phaseRef.current !== 'waiting' || !dragonRef.current) return;
    phaseRef.current = 'flying_in';
    flyProgressRef.current = 0;
    dragonRef.current.visible = true;
    cbRef.current.onFlyInStart?.();
  };

  // Trigger sequence when isMelting becomes true (if sprite is ready)
  useEffect(() => {
    if (isMelting && spriteRef.current) startSequence();
  }, [isMelting]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize PixiJS and load all dragon frame sets
  useEffect(() => {
    const initPixi = async () => {
      if (!containerRef.current) return;

      const app = new PIXI.Application();
      await app.init({
        resizeTo: containerRef.current,
        backgroundAlpha: 0,
        antialias: true,
      });
      containerRef.current.appendChild(app.canvas);
      appRef.current = app;

      const flyPaths = Array.from({ length: 8 }, (_, i) =>
        `/assets/dragon/__dragon_01_blue_flying_${i.toString().padStart(3, '0')}.png`);
      const landPaths = Array.from({ length: 12 }, (_, i) =>
        `/assets/dragon/__dragon_01_blue_land_${i.toString().padStart(3, '0')}.png`);
      const idlePaths = Array.from({ length: 20 }, (_, i) =>
        `/assets/dragon/__dragon_01_blue_idle_standing_${i.toString().padStart(3, '0')}.png`);
      const flamePaths = Array.from({ length: 20 }, (_, i) =>
        `/assets/dragon/__dragon_01_blue_standing_flame_with_flame_${i.toString().padStart(3, '0')}.png`);

      await PIXI.Assets.load([...flyPaths, ...landPaths, ...idlePaths, ...flamePaths]);

      const textures = {
        fly: flyPaths.map(f => PIXI.Assets.get(f)),
        land: landPaths.map(f => PIXI.Assets.get(f)),
        idle: idlePaths.map(f => PIXI.Assets.get(f)),
        flame: flamePaths.map(f => PIXI.Assets.get(f)),
      };
      texturesRef.current = textures;

      // Dragon starts hidden
      const dragon = new PIXI.AnimatedSprite(textures.idle);
      dragon.animationSpeed = 0.3;
      dragon.anchor.set(0.5);
      dragon.visible = false;
      dragonRef.current = dragon;
      app.stage.addChild(dragon);

      let time = 0;

      app.ticker.add((ticker) => {
        time += 0.05 * ticker.deltaTime;
        const { width, height } = app.screen;
        const isMobile = width < 768;
        const baseScale = isMobile ? 0.5 : 0.7;
        const dragonRestX = width * (isMobile ? 0.3 : 0.25);
        const dragonY = height * 0.5;
        const imageX = width * (isMobile ? 0.7 : 0.75);
        const imageY = height * 0.5;

        // ── Dragon state machine ──
        switch (phaseRef.current) {
          case 'waiting':
            break;

          case 'flying_in': {
            dragon.visible = true;
            if (dragon.textures !== textures.fly) {
              dragon.textures = textures.fly;
              dragon.animationSpeed = 0.4;
              dragon.loop = true;
              dragon.play();
            }
            flyProgressRef.current += 0.012 * ticker.deltaTime;
            const t = Math.min(flyProgressRef.current, 1);
            const eased = 1 - Math.pow(1 - t, 3);
            const startX = width + 100;
            dragon.x = startX + (dragonRestX - startX) * eased;
            dragon.y = dragonY;
            dragon.scale.set(-baseScale, baseScale); // mirrored (faces left)

            if (t >= 1) {
              phaseRef.current = 'landing';
              dragon.textures = textures.land;
              dragon.animationSpeed = 0.3;
              dragon.loop = false;
              dragon.scale.set(baseScale); // un-mirror (face right toward image)
              dragon.x = dragonRestX;
              dragon.gotoAndPlay(0);
              dragon.onComplete = () => {
                phaseRef.current = 'fire_breathing';
                meltAmountRef.current = 0;
                dragon.textures = textures.flame;
                dragon.animationSpeed = 0.2;
                dragon.loop = true;
                dragon.gotoAndPlay(0);
                dragon.onComplete = null;
                cbRef.current.onFireStart?.();
              };
            }
            break;
          }

          case 'landing':
            dragon.x = dragonRestX;
            dragon.y = dragonY;
            dragon.scale.set(baseScale);
            break;

          case 'fire_breathing': {
            dragon.x = dragonRestX;
            dragon.y = dragonY;
            dragon.scale.set(baseScale);
            dragon.scale.y = baseScale * (1 + Math.sin(time * 5) * 0.05);

            meltAmountRef.current += 0.008 * ticker.deltaTime;
            const melt = Math.min(meltAmountRef.current, 1);

            if (filterRef.current) {
              const u = (filterRef.current.resources as any).meltUniforms.uniforms;
              u.uMeltAmount.value = melt;
              u.uTime.value += 0.008 * ticker.deltaTime;
            }

            // Squash image into puddle
            if (spriteRef.current) {
              const squish = 1.0 - melt * 0.65; // 1.0 → 0.35
              const s = getImageScale(spriteRef.current, dragon, baseScale, isMobile, width);
              spriteRef.current.scale.x = s;
              spriteRef.current.scale.y = s * squish;
              spriteRef.current.x = imageX;
              const fullH = spriteRef.current.texture.height * s;
              spriteRef.current.y = imageY + (fullH - fullH * squish) / 2;
            }

            if (melt >= 1) {
              phaseRef.current = 'complete';
              dragon.textures = textures.idle;
              dragon.animationSpeed = 0.3;
              dragon.loop = true;
              dragon.play();
              cbRef.current.onComplete();
            }
            break;
          }

          case 'complete': {
            dragon.x = dragonRestX;
            dragon.y = dragonY;
            dragon.scale.set(baseScale);

            // Subtle puddle animation
            if (filterRef.current) {
              const u = (filterRef.current.resources as any).meltUniforms.uniforms;
              u.uTime.value += 0.003 * ticker.deltaTime;
            }

            // Maintain puddle shape
            if (spriteRef.current) {
              const s = getImageScale(spriteRef.current, dragon, baseScale, isMobile, width);
              spriteRef.current.scale.x = s;
              spriteRef.current.scale.y = s * 0.35;
              spriteRef.current.x = imageX;
              const fullH = spriteRef.current.texture.height * s;
              spriteRef.current.y = imageY + (fullH - fullH * 0.35) / 2;
            }
            break;
          }
        }

        // ── Image positioning (pre-melt phases) ──
        if (
          spriteRef.current &&
          phaseRef.current !== 'fire_breathing' &&
          phaseRef.current !== 'complete'
        ) {
          spriteRef.current.x = imageX;
          spriteRef.current.y = imageY;
          const s = getImageScale(spriteRef.current, dragon, baseScale, isMobile, width);
          spriteRef.current.scale.set(s);
        }
      });

      setIsReady(true);
    };

    initPixi();
    return () => {
      appRef.current?.destroy(true, { children: true, texture: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load and crop image texture
  useEffect(() => {
    if (!image || !appRef.current || !isReady) return;

    // Reset animation state for new image
    phaseRef.current = 'waiting';
    flyProgressRef.current = 0;
    meltAmountRef.current = 0;
    if (dragonRef.current) dragonRef.current.visible = false;

    const loadTexture = async () => {
      try {
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = image;
        });

        // Crop to AI bounding box
        let texture: PIXI.Texture;
        if (subjectBox && subjectBox.length === 4) {
          const [ymin, xmin, ymax, xmax] = subjectBox;
          const cropX = Math.floor((xmin / 1000) * img.width);
          const cropY = Math.floor((ymin / 1000) * img.height);
          const cropW = Math.floor(((xmax - xmin) / 1000) * img.width);
          const cropH = Math.floor(((ymax - ymin) / 1000) * img.height);

          if (cropW > 0 && cropH > 0) {
            const c = document.createElement('canvas');
            c.width = cropW;
            c.height = cropH;
            c.getContext('2d')!.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
            texture = PIXI.Texture.from(c);
          } else {
            texture = PIXI.Texture.from(img);
          }
        } else {
          texture = PIXI.Texture.from(img);
        }

        if (spriteRef.current) {
          appRef.current!.stage.removeChild(spriteRef.current);
        }

        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 0.5);

        const activeColors = getFiveDistinctColors(colors);
        const filter = PIXI.Filter.from({
          gl: { vertex: VERT_SHADER, fragment: MELT_SHADER },
          resources: {
            meltUniforms: {
              uTime: { value: 0, type: 'f32' },
              uMeltAmount: { value: 0, type: 'f32' },
              uColor1: { value: hexToVec3(activeColors[0]), type: 'vec3<f32>' },
              uColor2: { value: hexToVec3(activeColors[1]), type: 'vec3<f32>' },
              uColor3: { value: hexToVec3(activeColors[2]), type: 'vec3<f32>' },
              uColor4: { value: hexToVec3(activeColors[3]), type: 'vec3<f32>' },
              uColor5: { value: hexToVec3(activeColors[4]), type: 'vec3<f32>' },
            },
          },
        });

        sprite.filters = [filter];
        filterRef.current = filter;
        spriteRef.current = sprite;
        appRef.current!.stage.addChild(sprite);

        // Dragon renders on top of image
        if (dragonRef.current) {
          appRef.current!.stage.addChild(dragonRef.current);
        }

        // If isMelting is already true (texture loaded after flag was set), start now
        if (isMeltingRef.current) startSequence();
      } catch (err) {
        console.error('Failed to load texture for canvas', err);
      }
    };

    loadTexture();
  }, [image, isReady, colors, subjectBox]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} className="absolute inset-0 overflow-hidden" />;
};
