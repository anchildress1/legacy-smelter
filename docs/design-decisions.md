# Design Decisions — Deliberate Deviations from Original Spec

This document records intentional changes made during development that diverge from
`original-ai-studio-prompt.md`. The spec is the source of truth; this is the rationale layer.

---

## Stack

| Spec | Current | Reason |
|------|---------|--------|
| Vanilla JS, Full-stack Node.js | React + TypeScript + Vite | AI Studio generated a React scaffold; idiomatic for the toolchain and maintainability. |

---

## AI / Model

| Spec | Current | Reason |
|------|---------|--------|
| Gemini 1.5 Flash Vision API | `gemini-3.1-flash-lite-preview` | Upgraded to a later, lighter model. |
| Gemini extracts 5 dominant hex colors | Canvas pixel analysis extracts colors programmatically | Programmatic extraction is faster (no API round-trip), costs nothing, and produces more accurate color clusters. Gemini is still used for the damage report and bounding box. |

---

## UI / Aesthetic

| Spec | Current | Reason |
|------|---------|--------|
| Acid Green (data text), Neon Pink (accents), Neon Orange (highlights) | Hazard-amber, ash-white | Pure neon clashed with the final UI direction. Hazard-amber preserves the warning/industrial feel, while ash-white improves contrast and readability. **Color scheme is not final.** |
| Public feed: 5 most recent entries | 10 most recent entries | More context in the live feed is more interesting for a shared experience. |

---

## Animation

| Spec | Current | Reason |
|------|---------|--------|
| Dragon enter (fly-in) animation | Dragon performs a fly-in → land → melt sequence before settling into the standing-with-flames state | The entrance animation is now implemented in `SmelterCanvas`, so this is no longer deferred. |
