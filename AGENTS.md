# AGENTS

## invariants

- `impact_score = 5*sanction_count + 3*escalation_count + 2*breach_count`. Stored on every `incident_logs` doc. Required by `orderBy('impact_score','desc')` in `src/App.tsx` and `src/components/IncidentManifest.tsx`, backed by composite index `(impact_score DESC, timestamp DESC)` in `firestore.indexes.json`. Firestore has no expression indexes — removing the field breaks both feeds. Do not remove without also changing the sort key in those two queries and deleting the index.
- Weights live in `shared/impactScore.js` (`IMPACT_WEIGHTS = { sanction: 5, escalation: 3, breach: 2 }`). Single source for TS/JS. `firestore.rules` duplicates the formula inside `impactScore(data)` because rules cannot import JS — manual sync required.
- Counter updates must be **paired** with `impact_score`. Rules require `affectedKeys().hasOnly(['<counter>', 'impact_score'])`. Writing a counter alone, or `impact_score` alone, is rejected with `permission-denied`.
- Rules enforce `request.resource.data.impact_score == impactScore(request.resource.data)` on every allowed update. Client cannot write a drifted value.
- `incident_logs` rule: `allow create: if false`. All creates go through `POST /api/analyze` which uses `firebase-admin` (bypasses rules). Do not move creates to the client — atomic write of the doc + `global_stats.total_pixels_melted` + derived `impact_score` depends on admin SDK.
- `/api/analyze` is protected by `requireFirebaseAuth` middleware verifying a Firebase ID token (anonymous is fine). Do not remove.
- `parseSmeltLog` in `src/lib/smeltLogSchema.ts` is strict. Every field required, no fallbacks. New fields must be added to schema + parser + server write simultaneously or docs will be rejected client-side.

## changing a weight

1. Edit `shared/impactScore.js` `IMPACT_WEIGHTS`.
2. Edit `firestore.rules` `impactScore()` function body.
3. Edit the literal `+ 2` / `+ 3` / `- 3` deltas in `isBreachIncrement`, `isEscalationIncrement`, `isEscalationDecrement`.
4. Run `scripts/backfill-voting-fields.ts` against every environment.
5. Deploy rules to both projects (see deploy).

## deploy

Two Firebase projects. No default in `firebase.json`. Always deploy rules to unstable only unless user explicitly says both:

```bash
firebase deploy --only firestore:rules --project anchildress1-unstable
firebase deploy --only firestore:rules --project anchildress1
```

Failure mode: committing a rules edit without deploying produces 403 `permission-denied` on valid client writes. Verify deploy with `firebase_get_security_rules` MCP tool.

## scripts/sanction-incidents.ts

- Refuses to run without `system_migrations/voting-fields-v1` marker. Created by `backfill-voting-fields.ts`.
- Run lock at `system_locks/sanction-incidents` with TTL. Concurrent runs cannot double-sanction.
- `MAX_MODEL_FAILURES_PER_DOC = 3`: per-doc counter on `sanction_model_failures`. Exceeding quarantines the doc (`judged: true, sanctioned: false`) so broken prompts cannot stall the batch.
- `MAX_REQUERY_ITERATIONS = 3`: bounds the loop that re-queries after quarantining malformed docs.
- Iterates `candidates`, not `batch`, for the sanction write. `candidateDocsById` map used by both success and failure branches.

## scripts/backfill-voting-fields.ts

- Idempotent. Only patches docs missing a field or with drifted `impact_score`.
- Appends to `system_migrations/voting-fields-v1/runs` subcollection on every run. Never overwrites `first_run_at`. Audit trail is preserved across re-runs.

## memory

User-level memory at `~/.claude/projects/-Users-anchildress1-git-personal-legacy-smelter/memory/` persists across sessions. Referenced in `MEMORY.md` index:
- `project_post_merge_db_cleanup.md` — cleanup old-format docs from shared Firestore after merge.
- `feedback_no_quick_fixes.md` — no temporary workarounds, always full long-term solutions.
