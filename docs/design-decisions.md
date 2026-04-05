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
| Gemini 1.5 Flash Vision API | `gemini-2.5-flash` | Upgraded from `gemini-3.1-flash-lite-preview` (unstable preview) to `gemini-2.5-flash` (stable production model). |
| Gemini extracts 5 dominant hex colors | Canvas pixel analysis extracts colors programmatically, with Gemini fallback blending | Programmatic extraction is faster (no API round-trip), costs nothing, and produces more accurate color clusters. Gemini now also returns colors for creative fallback — blended in when confidence < 45 per spec heuristic. |
| Simple damage report + bounding box | Enriched 19-field structured response | Expanded to include legacy_infra_class, cursed_dx, smelt_rating, contamination fields, OG share fields, museum captions, and more per `gemini-implementation-and-share-spec.md`. |

---

## UI / Aesthetic

| Spec | Current | Reason |
|------|---------|--------|
| Acid Green (data text), Neon Pink (accents), Neon Orange (highlights) | Steel-blue, hazard-yellow | Pure neon clashed with the blue dragon palette. Steel-blue complements the dragon's coloring. **Color scheme is not final.** |
| Public feed: 5 most recent entries | 10 most recent entries | More context in the live feed is more interesting for a shared experience. |

---

## Animation

| Spec | Current | Reason |
|------|---------|--------|
| Dragon enter (fly-in) animation | Dragon starts in idle standing position | Deferred; standing-with-flames is acceptable for this version. Fly-in assets exist and can be wired later. |
