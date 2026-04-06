<div align="center">
<img width="1200" height="475" alt="Legacy Smelter" src="https://repository-images.githubusercontent.com/1201373945/f2802097-2afe-4c31-848f-a94cc13ca0b1" />
</div>

# Legacy Smelter

A satirical incident reporting system for condemned digital artifacts. Upload an image. Hotfix processes it. Output: molten slag.

The system analyzes uploaded images using Gemini Vision and files a formal postmortem — classification, severity, failure origin, disposition, archive note — before thermally decommissioning the artifact via dragon-based remediation.

## Features

- **Gemini Vision analysis** — 16-field structured incident schema delivered via Gemini's constrained JSON mode
- **Hotfix animation** — PixiJS dragon idle, fly-in, and smelt sequence with audio
- **Incident postmortem** — full structured report overlay with social share (X, Bluesky, Reddit, LinkedIn) plus copy-link
- **Global incident manifest** — real-time Firestore feed of all thermally decommissioned artifacts
- **Decommission index** — live cumulative pixel count across all incidents
- **Camera support** — deploy field scanner via device camera or file upload

## Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 + TypeScript + Vite |
| Animation | PixiJS 8 |
| AI | Gemini (`gemini-3.1-flash-lite-preview`) via `@google/genai` |
| Database | Firebase Firestore |
| Audio | Howler.js |
| Styling | Tailwind CSS v4 |

## Run locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```
   npm install
   ```
2. Create `.env.local` and set your Gemini API key:
   ```
   VITE_GEMINI_API_KEY=your_key_here
   ```
3. Start the dev server:
   ```
   npm run dev
   ```

The app runs at `http://localhost:3000`.

## Project structure

```
src/
├── App.tsx                          Main smelter page
├── main.tsx                         Root + hash-based page routing
├── types.ts                         SmeltLog + GlobalStats types
├── firebase.ts                      Firestore client
├── components/
│   ├── SmelterCanvas.tsx            PixiJS dragon animation
│   ├── IncidentReportOverlay.tsx    Postmortem modal + share
│   ├── IncidentManifest.tsx         Global incident manifest page
│   └── IncidentLogCard.tsx          Shared incident log card
├── services/
│   └── geminiService.ts             Gemini prompt, schema, analysis
└── lib/
    ├── utils.ts                     Pixel formatting + color utilities
    └── firestoreErrors.ts           Firestore error handling
docs/
├── ai-prompt.md                     AI generation constraints and field spec
├── ux-copy.md                       Voice, persona, and copy rules
├── design-decisions.md              Deliberate spec deviations
└── archive/
    ├── gemini-implementation-and-share-spec.md  Original Gemini spec (superseded)
    └── original-ai-studio-prompt.md             Original AI Studio scaffold prompt
```

## Docs

- [`docs/ai-prompt.md`](docs/ai-prompt.md) — AI prompt, severity tiers, field constraints
- [`docs/ux-copy.md`](docs/ux-copy.md) — Voice, persona rules, writing constraints for UI and AI copy
- [`docs/design-decisions.md`](docs/design-decisions.md) — Deliberate deviations from the original spec and their rationale
