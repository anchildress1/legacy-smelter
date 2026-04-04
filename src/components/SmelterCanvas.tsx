import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';

interface SmelterCanvasProps {
  image: string | null;
  isMelting: boolean;
  onComplete: () => void;
  colors: string[];
}

const MELT_SHADER = `
precision mediump float;

varying vec2 vTextureCoord;
uniform sampler2D uSampler;
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

// Voronoi noise function for marble effect
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
    
    vec4 baseColor = texture2D(uSampler, uv);
    
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
        
        // Add "slag" glow
        baseColor.rgb += vec3(1.0, 0.3, 0.0) * (1.0 - v) * uMeltAmount * 0.4;
    }
    
    // Fade out edges as it "liquefies"
    float edgeAlpha = 1.0 - smoothstep(0.7, 1.0, uMeltAmount);
    baseColor.a *= edgeAlpha;
    
    gl_FragColor = baseColor;
}
`;

export const SmelterCanvas: React.FC<SmelterCanvasProps> = ({ image, isMelting, onComplete, colors }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const spriteRef = useRef<PIXI.Sprite | null>(null);
  const filterRef = useRef<PIXI.Filter | null>(null);
  const dragonRef = useRef<PIXI.AnimatedSprite | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Helper to parse hex to vec3
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
      dragonSprite.animationSpeed = 0.3;
      dragonSprite.anchor.set(0.5);
      dragonRef.current = dragonSprite;
      app.stage.addChild(dragonSprite);

      // Positioning logic
      const updatePositions = () => {
        const { width, height } = app.screen;
        const isMobile = width < 768;
        
        // Dragon on the left
        dragonSprite.x = width * (isMobile ? 0.25 : 0.2);
        dragonSprite.y = height * 0.6;
        dragonSprite.scale.set(isMobile ? 0.4 : 0.6);
        
        if (spriteRef.current) {
          // Target image on the right
          spriteRef.current.x = width * (isMobile ? 0.75 : 0.8);
          spriteRef.current.y = height * 0.7;
          
          const targetSize = isMobile ? width * 0.2 : width * 0.15;
          const scale = targetSize / Math.max(spriteRef.current.texture.width, spriteRef.current.texture.height);
          spriteRef.current.scale.set(scale);
        }
      };

      updatePositions();
      dragonSprite.play();

      let time = 0;
      app.ticker.add((ticker) => {
        time += 0.05 * ticker.deltaTime;
        
        if (isMelting) {
          if (dragonSprite.textures !== meltTextures) {
            dragonSprite.textures = meltTextures;
            dragonSprite.play();
            dragonSprite.animationSpeed = 0.5;
            dragonSprite.loop = true;
          }
          dragonSprite.scale.y *= (1 + Math.sin(time * 5) * 0.005);
        } else {
          if (dragonSprite.textures !== idleTextures) {
            dragonSprite.textures = idleTextures;
            dragonSprite.play();
            dragonSprite.animationSpeed = 0.3;
            dragonSprite.loop = true;
          }
        }
        updatePositions();
      });

      setIsLoaded(true);
    };

    initPixi();

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
      }
    };
  }, []);

  // Handle image loading and filter initialization
  useEffect(() => {
    if (image && appRef.current && isLoaded) {
      const loadTexture = async () => {
        const texture = await PIXI.Assets.load(image);
        if (spriteRef.current) {
          appRef.current?.stage.removeChild(spriteRef.current);
        }
        
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5, 1.0); // Anchor to bottom for "puddle" effect
        
        const defaultColors = ["#eab308", "#38bdf8", "#27272a", "#18181b", "#52525b"];
        const activeColors = colors.length >= 5 ? colors : defaultColors;
        
        const filter = new PIXI.Filter({
          glProgram: PIXI.GlProgram.from({
            vertex: PIXI.defaultFilterVert,
            fragment: MELT_SHADER,
          }),
          resources: {
            uTime: 0,
            uMeltAmount: 0,
            uColor1: hexToVec3(activeColors[0]),
            uColor2: hexToVec3(activeColors[1]),
            uColor3: hexToVec3(activeColors[2]),
            uColor4: hexToVec3(activeColors[3]),
            uColor5: hexToVec3(activeColors[4]),
          }
        });
        
        sprite.filters = [filter];
        filterRef.current = filter;
        spriteRef.current = sprite;
        appRef.current?.stage.addChild(sprite);
      };
      
      loadTexture();
    }
  }, [image, isLoaded, colors]);

  // Handle melting process
  useEffect(() => {
    if (isMelting && filterRef.current && appRef.current) {
      let meltAmount = 0;
      const ticker = (t: PIXI.Ticker) => {
        meltAmount += 0.005 * t.deltaTime;
        if (filterRef.current) {
          filterRef.current.resources.uMeltAmount = Math.min(meltAmount, 1);
          filterRef.current.resources.uTime += 0.01 * t.deltaTime;
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

