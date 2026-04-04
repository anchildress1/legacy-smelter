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

float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

void main(void) {
    vec2 uv = vTextureCoord;
    
    // Downward melting effect
    float offset = random(vec2(uv.x, 0.0)) * uMeltAmount * 0.5;
    uv.y -= offset;
    
    // Heat distortion
    uv.x += sin(uv.y * 10.0 + uTime * 5.0) * 0.01 * uMeltAmount;
    
    vec4 color = texture2D(uSampler, uv);
    
    // Fade out as it melts
    color.a *= (1.0 - uMeltAmount * 0.5);
    
    // Add some "slag" glow
    if (uMeltAmount > 0.5) {
        color.rgb += vec3(1.0, 0.4, 0.0) * (uMeltAmount - 0.5) * 2.0;
    }
    
    gl_FragColor = color;
}
`;

export const SmelterCanvas: React.FC<SmelterCanvasProps> = ({ image, isMelting, onComplete, colors }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const spriteRef = useRef<PIXI.Sprite | null>(null);
  const filterRef = useRef<PIXI.Filter | null>(null);
  const [progress, setProgress] = useState(0);
  const isMeltingRef = useRef(isMelting);

  useEffect(() => {
    isMeltingRef.current = isMelting;
  }, [isMelting]);

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

      // Define frames for both animations
      const idleFrames = Array.from({ length: 20 }, (_, i) => 
        `/assets/dragon/__dragon_01_blue_idle_standing_${i.toString().padStart(3, '0')}.png`
      );

      const meltFrames = Array.from({ length: 20 }, (_, i) => 
        `/assets/dragon/__dragon_01_blue_standing_flame_with_flame_${i.toString().padStart(3, '0')}.png`
      );

      // Load all textures
      await PIXI.Assets.load([...idleFrames, ...meltFrames]);

      const idleTextures = idleFrames.map(f => PIXI.Assets.get(f));
      const meltTextures = meltFrames.map(f => PIXI.Assets.get(f));

      // Create and manage the AnimatedSprite
      const dragonSprite = new PIXI.AnimatedSprite(idleTextures);
      dragonSprite.animationSpeed = 0.3;
      dragonSprite.anchor.set(0.5);
      dragonSprite.x = 120;
      dragonSprite.y = app.screen.height / 2;
      dragonSprite.play();
      app.stage.addChild(dragonSprite);

      let time = 0;

      app.ticker.add((ticker) => {
        time += 0.05 * ticker.deltaTime;
        
        if (isMeltingRef.current) {
          if (dragonSprite.textures !== meltTextures) {
            dragonSprite.textures = meltTextures;
            dragonSprite.play();
            dragonSprite.animationSpeed = 0.5;
          }
          
          if (dragonSprite.x < 150) {
            dragonSprite.x += 5 * ticker.deltaTime;
          }
          
          dragonSprite.scale.y = 1 + Math.sin(time * 3) * 0.02;
          dragonSprite.scale.x = 1 + Math.cos(time * 4) * 0.02;
        } else {
          if (dragonSprite.textures !== idleTextures) {
            dragonSprite.textures = idleTextures;
            dragonSprite.play();
            dragonSprite.animationSpeed = 0.3;
          }
          
          if (dragonSprite.x > 120) {
            dragonSprite.x -= 2 * ticker.deltaTime;
          }
          
          dragonSprite.scale.y = 1 + Math.sin(time) * 0.04;
          dragonSprite.scale.x = 1 + Math.cos(time * 0.8) * 0.015;
        }
      });
    };

    initPixi();

    return () => {
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true });
      }
    };
  }, []);

  useEffect(() => {
    if (image && appRef.current) {
      const loadTexture = async () => {
        const texture = await PIXI.Assets.load(image);
        if (spriteRef.current) {
          appRef.current.stage.removeChild(spriteRef.current);
        }
        
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.x = appRef.current.screen.width / 2;
        sprite.y = appRef.current.screen.height / 2;
        
        // Scale to fit
        const scale = Math.min(
          (appRef.current.screen.width * 0.8) / sprite.width,
          (appRef.current.screen.height * 0.6) / sprite.height
        );
        sprite.scale.set(scale);
        
        // Apply melt filter
        const filter = new PIXI.Filter({
          glProgram: PIXI.GlProgram.from({
            vertex: PIXI.defaultFilterVert,
            fragment: MELT_SHADER,
          }),
          resources: {
            uTime: 0,
            uMeltAmount: 0,
          }
        });
        
        sprite.filters = [filter];
        filterRef.current = filter;
        spriteRef.current = sprite;
        appRef.current.stage.addChild(sprite);
      };
      
      loadTexture();
    }
  }, [image]);

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

  return <div ref={containerRef} className="w-full h-full relative overflow-hidden" />;
};
