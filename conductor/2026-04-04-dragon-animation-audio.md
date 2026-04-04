# Dragon Animation and Audio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder dragon and sounds with a high-quality `PIXI.AnimatedSprite` and local audio assets.

**Architecture:** 
*   **Animation:** Load frame-by-frame PNGs in `SmelterCanvas.tsx` using `PIXI.Assets`. Use `PIXI.AnimatedSprite` to switch between `idle` and `melting` (fire-breathing) states.
*   **Audio:** Update `App.tsx` to use `Howler.js` with local `public/assets/audio/` files. Map `sfx-fly-in.wav`, `sfx-purr.wav`, and `sfx-smelt.wav` to appropriate triggers.

**Tech Stack:** React, PixiJS v8, Howler.js, Vite.

---

### Task 1: Update Audio in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update Howl instances**

```typescript
// Audio Assets (Local)
const fireSound = new Howl({ src: ['/assets/audio/sfx-smelt.wav'], loop: true });
const sizzleSound = new Howl({ src: ['/assets/audio/sfx-purr.wav'], loop: true }); // Using purr as secondary/background sizzle
const flyInSound = new Howl({ src: ['/assets/audio/sfx-fly-in.wav'] });
```

- [ ] **Step 2: Commit changes**

```bash
git add src/App.tsx
git commit -m "feat: use local audio assets for smelting and fly-in

Generated-by: Gemini <gemini@google.com>"
```

---

### Task 2: Implement AnimatedSprite in SmelterCanvas.tsx

**Files:**
- Modify: `src/components/SmelterCanvas.tsx`

- [ ] **Step 1: Define frame paths and loader logic**

Modify the `initPixi` function to load the PNG frames.

```typescript
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
```

- [ ] **Step 2: Create and manage the AnimatedSprite**

Replace the `PIXI.Graphics` dragon with the `AnimatedSprite`.

```typescript
const dragonSprite = new PIXI.AnimatedSprite(idleTextures);
dragonSprite.animationSpeed = 0.3;
dragonSprite.anchor.set(0.5);
dragonSprite.x = 120; // Adjusted position
dragonSprite.y = app.screen.height / 2;
dragonSprite.play();
app.stage.addChild(dragonSprite);
```

- [ ] **Step 3: Update state transition logic**

Switch textures based on `isMeltingRef.current`.

```typescript
app.ticker.add((ticker) => {
  if (isMeltingRef.current && dragonSprite.textures !== meltTextures) {
    dragonSprite.textures = meltTextures;
    dragonSprite.play();
    dragonSprite.animationSpeed = 0.5; // Faster for fire breathing
  } else if (!isMeltingRef.current && dragonSprite.textures !== idleTextures) {
    dragonSprite.textures = idleTextures;
    dragonSprite.play();
    dragonSprite.animationSpeed = 0.3;
  }
});
```

- [ ] **Step 4: Commit changes**

```bash
git add src/components/SmelterCanvas.tsx
git commit -m "feat: implement PIXI.AnimatedSprite for dragon idle and melting states

Generated-by: Gemini <gemini@google.com>"
```

---

### Task 3: Final Verification

- [ ] **Step 1: Check build and run**

Run: `npm run build`
Expected: Successful build with no TS errors.

- [ ] **Step 2: Manual verification (visual check)**

Ensure the dragon animation is smooth and audio triggers correctly.
