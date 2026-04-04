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

      // Create a dragon placeholder (matching the blue dragon)
      const dragon = new PIXI.Graphics();
      dragon.beginFill(0x38bdf8); // Sky blue
      dragon.drawPolygon([0, 0, 100, 50, 0, 100]);
      dragon.endFill();
      dragon.x = -150;
      dragon.y = app.screen.height / 2 - 50;
      app.stage.addChild(dragon);

      app.ticker.add((ticker) => {
        if (isMelting) {
          // Dragon enters
          if (dragon.x < 50) {
            dragon.x += 5 * ticker.deltaTime;
          }
          
          // Fire breathing (simulated by color change to hazard yellow)
          if (dragon.x >= 50) {
            dragon.tint = 0xeab308;
          }
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
