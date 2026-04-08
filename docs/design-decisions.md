# Design Decisions — Deliberate Deviations from Original Spec

This document records intentional changes made during development that diverge from
`archive/original-ai-studio-prompt.md`. The spec is the source of truth; this is the rationale layer.

---

## Stack

| Spec | Current | Reason |
|------|---------|--------|
| Vanilla JS, Full-stack Node.js | React + TypeScript + Vite | AI Studio generated a React scaffold; idiomatic for the toolchain and maintainability. |

---

## AI / Model

| Spec | Current | Reason |
|------|---------|--------|
| Gemini 1.5 Flash Vision API | `gemini-3.1-flash-lite-preview` | Lighter model — stable production. |
| Gemini extracts 5 dominant hex colors | Gemini returns `dominant_hex_colors`; app sanitizes, deduplicates, and pads to 5 via `getFiveDistinctColors` | Canvas-based programmatic extraction was removed. Color data stays in the single Gemini response to avoid a second pass over image data. |
| Simple damage report + bounding box | Enriched 16-field structured response | Fields: legacy_infra_class, diagnosis, dominant_hex_colors, chromatic_profile, system_dx, severity, primary_contamination, contributing_factor, failure_origin, disposition, incident_feed_summary, archive_note, og_headline, share_quote, anon_handle, subject_box. Current prompt and schema in `src/services/geminiService.ts` and `docs/classification-prompt.md`. |

---

## UI / Aesthetic

| Spec | Current | Reason |
|------|---------|--------|
| Acid Green (data text), Neon Pink (accents), Neon Orange (highlights) | Hazard-amber, ash-white | Pure neon clashed with the final UI direction. Hazard-amber preserves the warning/industrial feel, while ash-white improves contrast and readability. |
| Public feed: 5 most recent entries | Main page: 3 most recent; manifest page: up to 50 | Main page feed is a quick preview. Manifest page provides the full incident archive. |

---

## Animation

| Spec | Current | Reason |
|------|---------|--------|
| Dragon enter (fly-in) animation | Dragon performs a fly-in → land → melt sequence before settling into the standing-with-flames state | The entrance animation is now implemented in `SmelterCanvas`, so this is no longer deferred. |
