import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { getFiveDistinctColors } from '../lib/utils';

interface SmelterCanvasProps {
  image: string | null;
  isMelting: boolean;
  onComplete: () => void;
  colors: string[];
  subjectBox: number[] | null;
}

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
        
        // Initial heat distortion
        float distortion = sin(uv.y * 15.0 + uTime * 8.0) * 0.02 * uMeltAmount;
        uv.x += distortion;
        
        // Downward melting effect
        float meltOffset = random(vec2(uv.x, 0.0)) * uMeltAmount * 0.8;
        uv.y -= meltOffset;
        
        vec4 baseColor = texture2D(uTexture, uv);
        
        // Transition to Voronoi Marble Pattern
        if (uMeltAmount > 0.3) {
            float v = voronoi(uv * 5.0 + uTime * 0.5);
            float marble = sin(v * 10.0 + uTime) * 0.5 + 0.5;
            
            vec3 puddleColor;
            if (marble < 0.2) puddleColor = uColor1;
            else if (marble < 0.4) puddleColor = uColor2;
            else if (marble < 0.6) puddleColor = uColor3;
            else if (marble < 0.8) puddleColor = uColor4;
            else puddleColor = uColor5;
            
            float blend = smoothstep(0.3, 0.8, uMeltAmount);
            baseColor.rgb = mix(baseColor.rgb, puddleColor, blend);
            baseColor.a = max(baseColor.a, blend);
            
            // Add "slag" glow
            baseColor.rgb += vec3(1.0, 0.3, 0.0) * (1.0 - v) * uMeltAmount * 0.4;
        }
        
        // Fade out edges as it "liquefies"
        float edgeAlpha = 1.0 - smoothstep(0.7, 1.0, uMeltAmount);
        baseColor.a *= edgeAlpha;
        
        gl_FragColor = baseColor;
    }
`;

export const SmelterCanvas: React.FC<SmelterCanvasProps> = ({ image, isMelting, onComplete, colors, subjectBox }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const spriteRef = useRef<PIXI.Sprite | null>(null);
  const filterRef = useRef<PIXI.Filter | null>(null);
  const dragonRef = useRef<PIXI.AnimatedSprite | null>(null);
  const isMeltingRef = useRef(isMelting);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    isMeltingRef.current = isMelting;
  }, [isMelting]);

  const hexToVec3 = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return [r, g, b];
  };

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

      const idleFrames = Array.from({ length: 20 }, (_, i) => 
        `/assets/dragon/__dragon_01_blue_idle_standing_${i.toString().padStart(3, '0')}.png`
      );

      const meltFrames = Array.from({ length: 20 }, (_, i) => 
        `/assets/dragon/__dragon_01_blue_standing_flame_with_flame_${i.toString().padStart(3, '0')}.png`
      );

      await PIXI.Assets.load([...idleFrames, ...meltFrames]);

      const idleTextures = idleFrames.map(f => PIXI.Assets.get(f));
      const meltTextures = meltFrames.map(f => PIXI.Assets.get(f));

      const dragonSprite = new PIXI.AnimatedSprite(idleTextures);
      dragonSprite.animationSpeed = 0.5;
      dragonSprite.anchor.set(0.5);
      dragonRef.current = dragonSprite;
      app.stage.addChild(dragonSprite);

      const updatePositions = () => {
        const { width, height } = app.screen;
        const isMobile = width < 768;
        
        dragonSprite.x = width * (isMobile ? 0.3 : 0.25);
        dragonSprite.y = height * 0.5;
        dragonSprite.scale.set(isMobile ? 0.5 : 0.7);
        
        if (spriteRef.current) {
          spriteRef.current.x = width * (isMobile ? 0.7 : 0.75);
          spriteRef.current.y = height * 0.5;
          
          const targetSize = isMobile ? width * 0.3 : width * 0.25;
          const currentSize = Math.max(spriteRef.current.texture.width, spriteRef.current.texture.height);
          if (currentSize > 0) {
            spriteRef.current.scale.set(targetSize / currentSize);
          }
        }
      };

      dragonSprite.play();

      let time = 0;
      app.ticker.add((ticker) => {
        time += 0.05 * ticker.deltaTime;
        
        if (isMeltingRef.current) {
          if (dragonSprite.textures !== meltTextures) {
            dragonSprite.textures = meltTextures;
            dragonSprite.play();
          }
          dragonSprite.scale.y *= (1 + Math.sin(time * 5) * 0.005);
        } else {
          if (dragonSprite.textures !== idleTextures) {
            dragonSprite.textures = idleTextures;
            dragonSprite.play();
          }
        }
        updatePositions();
      });

      setIsReady(true);
    };

    initPixi();

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
      }
    };
  }, []);

  useEffect(() => {
    if (image && appRef.current && isReady) {
      const loadTexture = async () => {
        try {
          const img = new Image();
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = image;
          });

          const texture = PIXI.Texture.from(img);
          
          if (spriteRef.current) {
            appRef.current!.stage.removeChild(spriteRef.current);
          }
          
          const sprite = new PIXI.Sprite(texture);
          sprite.anchor.set(0.5, 1.0);

          if (subjectBox && subjectBox.length === 4) {
            const [ymin, xmin, ymax, xmax] = subjectBox;
            const w = img.width;
            const h = img.height;
            const cropX = Math.floor((xmin / 1000) * w);
            const cropY = Math.floor((ymin / 1000) * h);
            const cropW = Math.floor(((xmax - xmin) / 1000) * w);
            const cropH = Math.floor(((ymax - ymin) / 1000) * h);
            
            if (cropW > 0 && cropH > 0) {
              const bounds = new PIXI.Graphics();
              // Bright red targeting box
              bounds.rect(cropX - w/2, cropY - h, cropW, cropH);
              bounds.stroke({ width: 6, color: 0xff0000, alpha: 0.8 });
              sprite.addChild(bounds);
            }
          }
          
          const activeColors = getFiveDistinctColors(colors);
          
          const filter = PIXI.Filter.from({
            gl: {
              vertex: VERT_SHADER,
              fragment: MELT_SHADER,
            },
            resources: {
              meltUniforms: {
                uTime: { value: 0, type: 'f32' },
                uMeltAmount: { value: 0, type: 'f32' },
                uColor1: { value: hexToVec3(activeColors[0]), type: 'vec3<f32>' },
                uColor2: { value: hexToVec3(activeColors[1]), type: 'vec3<f32>' },
                uColor3: { value: hexToVec3(activeColors[2]), type: 'vec3<f32>' },
                uColor4: { value: hexToVec3(activeColors[3]), type: 'vec3<f32>' },
                uColor5: { value: hexToVec3(activeColors[4]), type: 'vec3<f32>' },
              }
            }
          });
          
          sprite.filters = [filter];
          filterRef.current = filter;
          spriteRef.current = sprite;
          appRef.current!.stage.addChild(sprite);
        } catch (err) {
          console.error("Failed to load texture for canvas", err);
        }
      };
      
      loadTexture();
    }
  }, [image, isReady, colors, subjectBox]);

  useEffect(() => {
    if (isMelting && filterRef.current && appRef.current) {
      let meltAmount = 0;
      const ticker = (t: PIXI.Ticker) => {
        meltAmount += 0.015 * t.deltaTime;
        if (filterRef.current) {
          const uniforms = (filterRef.current.resources as any).meltUniforms.uniforms;
          uniforms.uMeltAmount = Math.min(meltAmount, 1);
          uniforms.uTime += 0.01 * t.deltaTime;
        }
        
        if (meltAmount >= 1) {
          appRef.current?.ticker.remove(ticker);
          onComplete();
        }
      };
      
      appRef.current.ticker.add(ticker);
    }
  }, [isMelting]);

  return <div ref={containerRef} className="w-full h-full relative overflow-hidden pointer-events-none" />;
};
