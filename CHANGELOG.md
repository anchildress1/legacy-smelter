# Changelog

## [2.0.0](https://github.com/anchildress1/legacy-smelter/compare/v1.0.0...v2.0.0) (2026-04-13)


### Features

* dragon animation ([#1](https://github.com/anchildress1/legacy-smelter/issues/1)) ([c4a7f66](https://github.com/anchildress1/legacy-smelter/commit/c4a7f66c3bf37ddf51813403fb8775995a1ddf0d))
* Enable anonymous authentication and public read access ([c83d3be](https://github.com/anchildress1/legacy-smelter/commit/c83d3be5085064e3f1dcc630fcd4f99142a080f9))
* escalation voting, breach tracking, and AI sanctions ([#13](https://github.com/anchildress1/legacy-smelter/issues/13)) ([fcae007](https://github.com/anchildress1/legacy-smelter/commit/fcae007a1a0e650e3b39efa6fd9aeb2e3c04eed4))
* Gemini AI analysis, incident schema, OG share, and UX overhaul ([#4](https://github.com/anchildress1/legacy-smelter/issues/4)) ([293b5bd](https://github.com/anchildress1/legacy-smelter/commit/293b5bd2c3a1fafbc6d2195b951b8dff38c8712d))
* Initialize Legacy Smelter project structure ([b846f97](https://github.com/anchildress1/legacy-smelter/commit/b846f971c5376d8f29a22b982a89e47c0741791f))
* Introduce camera input and refine canvas dragon ([84518b7](https://github.com/anchildress1/legacy-smelter/commit/84518b7107cdbbdbda76a348fc8082d73b7b0fc8))
* move Gemini API calls server-side to secure API key ([#12](https://github.com/anchildress1/legacy-smelter/issues/12)) ([a832032](https://github.com/anchildress1/legacy-smelter/commit/a83203224752b8d11974d8b67b39d1e3ca313fd9))
* OG share URLs, breach tracking, and manifest improvements ([#11](https://github.com/anchildress1/legacy-smelter/issues/11)) ([18bb8a0](https://github.com/anchildress1/legacy-smelter/commit/18bb8a0772bc7e65033c417c2e2f49aba9e0deb9))
* **sanction:** server-side sanction judging + prod-prep cleanup ([#24](https://github.com/anchildress1/legacy-smelter/issues/24)) ([deb4dac](https://github.com/anchildress1/legacy-smelter/commit/deb4dac6b1764af063e521d2ce4d72d3aa35b8d5))
* Simplify Firebase auth and data validation ([15f4420](https://github.com/anchildress1/legacy-smelter/commit/15f4420cadb0adaa05cb1a0a14b6255d08e96bca))


### Bug Fixes

* drop backwards-compat layer and harden full incident pipeline ([#14](https://github.com/anchildress1/legacy-smelter/issues/14)) ([07ee94c](https://github.com/anchildress1/legacy-smelter/commit/07ee94c25e816427c09069d443d099de532b9f9c))
* smelter animation sequence and visual overhaul ([#2](https://github.com/anchildress1/legacy-smelter/issues/2)) ([d8973ec](https://github.com/anchildress1/legacy-smelter/commit/d8973ec7311ccca43e278cd3bc90b05d7116ad30))


### Miscellaneous Chores

* release 2.0.0 ([f2cdc43](https://github.com/anchildress1/legacy-smelter/commit/f2cdc43a8adc7bb2aabea6c08f945159bfe40634))

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
