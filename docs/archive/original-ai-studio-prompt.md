Here is the project plan. Ask clarifying questions where needed. You have complete creative freedom and are expected to produce a modern style 2026 production grade application with technical excellence and zero temporary fixes. Use placeholders for spriter patterns and sounds.

# Specification: The Legacy Smelter

## 1. Overview
A hardware-accelerated mobile web app that visually melts user-uploaded legacy tech. A dragon animates in, breathes fire (WebGL Shaders), and melts the input image into a puddle of slag. Tracks global pixels melted and maintains a live public feed populated by AI-generated damage reports.

## 2. Technical Stack
* **Environment:** Full-stack Node.js.
* **Frontend:** HTML5, CSS3, Vanilla JS (Mobile-first).
* **Graphics:** PixiJS (WebGL2).
* **Animation:** PixiJS `AnimatedSprite` (using provided frame-by-frame PNG keyframes).
* **Database:** Firebase Firestore.
* **AI:** Gemini 1.5 Flash Vision API.

## 3. Core Features & Flow
1.  **Input:** Image upload or camera capture.
2.  **AI Analysis (Target: Best Google AI Usage):**
    * Gemini Vision extracts 5 dominant hex colors.
    * Gemini generates a chaotic damage report (e.g., "12.1M pixels of cursed machinery reduced to slag!").
3.  **Smelting Visual Sequence:**
    * Dragon enter animation and "breathe_fire" sequence.
    * Apply heat distortion and downward melting fragment shaders to the input image.
    * Transition the melt into a glossy, marbled Voronoi noise pattern puddle using the extracted hex colors.
4.  **Database (Firestore):**
    * Calculate image `pixel_area`.
    * **Insert:** Write `pixel_count`, `damage_report` (from Gemini), and `timestamp` to the `smelt_logs` collection.
    * **Fetch:** Increment and update the global total `pixel_count`. Fetch the 5 most recent `smelt_logs` entries for the public feed.

## 4. Audio Pipeline
Uses `Howler.js` for mobile polyphonic playback.

| Effect Trigger | Audio Asset |
| :--- | :--- |
| **Fire Breathe** | Sustained fire/jet engine sound (use provided asset) |
| **Melting Shader** | Sizzling/melting noise (use provided asset) |

## 5. UI Aesthetic
* **Energy:** Industrial Blast Bunker (Heavy, brutalist, functional).
* **Visual Elements:** Scuffed concrete backgrounds, static hazard stripes, heavy block buttons, flat UI panels. No complex UI animations.
* **Color Palette:** * Base: Concrete Grey
    * Text/Data: Acid Green
    * Accents: Neon Pink
    * Highlights/Warnings: Neon Orange
* **Typography:** Bold, brutalist sans-serif or mechanical monospace.
* **Public Feed (The Slag Manifest):** A static list displaying a maximum of the 5 most recent heavy, concrete-grey cards. Each card displays a damage report fetched from Firestore in Acid Green text, stamped with the pixel count in Neon Pink. The left edge features a thick vertical stripe using a Gemini-extracted hex color from that specific smelt.
