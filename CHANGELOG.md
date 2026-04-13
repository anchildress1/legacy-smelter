# Changelog

## [2.0.0](https://github.com/anchildress1/legacy-smelter/compare/v1.0.0...v2.0.0) (2026-04-13) 🔥⚖️

> *v2 is what happens when the dragon gets a compliance department and I stop pretending this was just a joke with particle effects.*

Legacy Smelter stopped being a dramatic screenshot incinerator and became a full incident pipeline. The app now handles anonymous auth, public archive reads, richer manifest and share flows, escalation, breach tracking, and server-side sanctions, which means a bad artifact can now be reported, judged, and publicly humiliated with considerably more structure than is strictly healthy.

The rest of the release is cleanup in the unglamorous places that usually catch fire at 2 a.m. Gemini calls moved off the client, the pipeline got stricter about schemas and backwards-compat sludge, deploy wiring stopped lying about secrets, Docker finally brings along the shared server modules it needs, and the UI got another hard pass so cards, telemetry, and overlays look like decisions instead of leftovers.

It is, in short, the same furnace with better governance and fewer excuses.

<details>
<summary>Commit trail, if you need the receipts</summary>

- [Initialize Legacy Smelter project structure](https://github.com/anchildress1/legacy-smelter/commit/b846f971c5376d8f29a22b982a89e47c0741791f)
- [Dragon animation](https://github.com/anchildress1/legacy-smelter/issues/1)
- [Introduce camera input and refine canvas dragon](https://github.com/anchildress1/legacy-smelter/commit/84518b7107cdbbdbda76a348fc8082d73b7b0fc8)
- [Simplify Firebase auth and data validation](https://github.com/anchildress1/legacy-smelter/commit/15f4420cadb0adaa05cb1a0a14b6255d08e96bca)
- [Gemini AI analysis, incident schema, OG share, and UX overhaul](https://github.com/anchildress1/legacy-smelter/issues/4)
- [Move Gemini API calls server-side to secure API key](https://github.com/anchildress1/legacy-smelter/issues/12)
- [OG share URLs, breach tracking, and manifest improvements](https://github.com/anchildress1/legacy-smelter/issues/11)
- [Escalation voting, breach tracking, and AI sanctions](https://github.com/anchildress1/legacy-smelter/issues/13)
- [Drop backwards-compat layer and harden full incident pipeline](https://github.com/anchildress1/legacy-smelter/issues/14)
- [Coverage and targeted hardening](https://github.com/anchildress1/legacy-smelter/issues/15)
- [UI redesign: incident card, overlay telemetry band, SeverityBadge](https://github.com/anchildress1/legacy-smelter/commit/484feff2ca71b0eb2dd57130c01eba1f02c84fa8)
- [Rewrite v1 release notes](https://github.com/anchildress1/legacy-smelter/commit/6390422600b041f5fbf9c23c41796c85b5037980)
- [Deploy fix: use the actual Gemini secret name](https://github.com/anchildress1/legacy-smelter/commit/58f92d2ea3e8bc6d6d43fd05466dc33c1d8b42a8)
- [Docker build: include shared server modules](https://github.com/anchildress1/legacy-smelter/commit/342292ec4b8679687cc62d0af2d37a7a3caf8ad2)
- [Refresh the release branch after merge](https://github.com/anchildress1/legacy-smelter/commit/c71b8f62f7751caf5284c90ce5005b7e19371393)
- [Server-side sanction judging and prod-prep cleanup](https://github.com/anchildress1/legacy-smelter/issues/24)
- [Release 2.0.0](https://github.com/anchildress1/legacy-smelter/commit/f2cdc43a8adc7bb2aabea6c08f945159bfe40634)
</details>

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
