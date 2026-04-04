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

      // Create a dragon container
      const dragon = new PIXI.Container();
      dragon.pivot.set(50, 50);
      dragon.x = 70;
      dragon.y = app.screen.height / 2;

      const dragonBody = new PIXI.Graphics();
      dragonBody.beginFill(0x38bdf8); // Sky blue
      dragonBody.drawPolygon([0, 0, 100, 50, 0, 100]);
      dragonBody.endFill();
      
      const dragonEye = new PIXI.Graphics();
      dragonEye.beginFill(0xffffff);
      dragonEye.drawCircle(0, 0, 8);
      dragonEye.endFill();
      dragonEye.x = 30;
      dragonEye.y = 30;
      
      const dragonPupil = new PIXI.Graphics();
      dragonPupil.beginFill(0x18181b);
      dragonPupil.drawCircle(0, 0, 4);
      dragonPupil.endFill();
      dragonPupil.x = 34;
      dragonPupil.y = 30;

      dragon.addChild(dragonBody, dragonEye, dragonPupil);
      app.stage.addChild(dragon);

      let time = 0;
      let blinkTimer = 0;

      app.ticker.add((ticker) => {
        time += 0.05 * ticker.deltaTime;
        blinkTimer += ticker.deltaTime;
        
        if (isMeltingRef.current) {
          // Active fire breathing state
          if (dragon.x < 100) {
            dragon.x += 5 * ticker.deltaTime;
          }
          
          if (dragon.x >= 100) {
            dragonBody.tint = 0xeab308; // Hazard yellow
          }
          
          // Intense breathing/shaking
          dragon.scale.y = 1 + Math.sin(time * 3) * 0.02;
          dragon.scale.x = 1 + Math.cos(time * 4) * 0.02;
          
          // Angry eye
          dragonEye.scale.y = 0.5;
          dragonPupil.scale.y = 0.5;
        } else {
          // Idle state
          dragonBody.tint = 0xffffff; // Reset tint
          
          if (dragon.x > 70) {
            dragon.x -= 2 * ticker.deltaTime;
          }
          
          // Gentle breathing
          dragon.scale.y = 1 + Math.sin(time) * 0.04;
          dragon.scale.x = 1 + Math.cos(time * 0.8) * 0.015;
          
          // Eye blink logic
          if (blinkTimer > 150) { // Blink occasionally
            dragonEye.scale.y = 0.1;
            dragonPupil.scale.y = 0.1;
            if (blinkTimer > 160) blinkTimer = 0; // Reset after blink
          } else {
            // Smoothly open eye
            dragonEye.scale.y += (1 - dragonEye.scale.y) * 0.2;
            dragonPupil.scale.y += (1 - dragonPupil.scale.y) * 0.2;
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
