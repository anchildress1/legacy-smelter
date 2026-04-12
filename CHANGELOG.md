# Changelog

## [1.0.0](https://github.com/anchildress1/legacy-smelter/compare/b846f971c5376d8f29a22b982a89e47c0741791f...3a41855) (2026-04-11) 🫗🧾

> *We made it to v1. The furnace works, the dragon flies, and for once I deferred a feature instead of letting scope creep win on points.*

This is the first real release of Legacy Smelter, which is my extremely reasonable solution to every legacy problem: take a screenshot, hand it to Hotfix, and let the dragon smelt the evidence into oblivion. Was the system salvageable? Probably not. That is what the fire is for.

The core loop is here and working: upload from disk or use the camera, send the artifact through Gemini, get back a full incident report, then watch Hotfix do what change management never could. Every smelt produces a structured postmortem, lands in the public incident archive, and gets a proper share page so the unfurl copy holds up when you send it to other people who also have history with bad systems.

There is also escalation, because some incidents deserve witnesses. Friends can pile on, validate your suffering, and help a truly bad artifact climb the board like it earned the attention. One planned feature got pushed to v2 instead of being forced into this release while still damp and making threats. That was me briefly behaving like an adult. I don’t expect it to become a pattern.

Important boring note, because this is the part people ignore and then act surprised about later: **do not upload corporate, sensitive, or private material.** The app does not store the source image in Firestore, but the image is sent to Gemini for analysis. Per Google’s current Gemini API policy docs, prompts, contextual information, and **output may be retained for 55 days** for abuse and policy enforcement, and that logged **data is not used to train or fine-tune models beyond policy-enforcement systems.** So no, the app is not building an image archive. Also no, that does not make this a safe place for your employer’s confidential nonsense.

<details>
<summary>Commit trail, if you need the receipts</summary>

- [Core analysis system, incident schema, OG share path, and UX rebuild](https://github.com/anchildress1/legacy-smelter/issues/4)
- [Server-side Gemini calls so the API key stops wandering around the client](https://github.com/anchildress1/legacy-smelter/issues/12)
- [Share URLs, manifest improvements, and breach tracking](https://github.com/anchildress1/legacy-smelter/issues/11)
- [Escalation flow and moderation groundwork](https://github.com/anchildress1/legacy-smelter/commit/fcae007a1a0e650e3b39efa6fd9aeb2e3c04eed4)
- [Pipeline hardening and backwards-compat cleanup](https://github.com/anchildress1/legacy-smelter/issues/14)
- [Animation sequence and Hotfix cleanup](https://github.com/anchildress1/legacy-smelter/issues/2)
- [Coverage and targeted hardening](https://github.com/anchildress1/legacy-smelter/issues/15)
</details>
