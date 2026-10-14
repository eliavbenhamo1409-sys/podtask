# Edge Functions

Deno functions deployed to Supabase project `podtask` (`jxlrpewoqikpswxmtdma`).
They are excluded from the repo's `tsc`/`eslint` gates and Deno is not installed
locally, so **there is no local gate for this folder**: review carefully and
deploy one function at a time.

## Functions

| Slug | Called from | Purpose | Secrets |
| --- | --- | --- | --- |
| `prepare-submission` | processing screen (`prepareSubmissionInvokeSb`) | Parse the uploaded file, analyze it, write a POOL of 12 typed questions (`kind`, verbatim `anchor`, `key_points`) and a seeded selection of 5 (`plan.questions`; the pool stays in `plan.pool`), store the raw document text (TXT/DOCX) for the overlap check, create the `interviews` row. Idempotent once `interview_ready`. | `openai_realtime2` |
| `interview-control` | room page (`startInterviewSb`), consent screen, mic-test (exemption), the room's telemetry queue | Service-role state changes for the student side: `consent` (records the integrity notice acknowledgement), `start` (ready → in_progress or resume; requires the consent when the assignment asks for one; returns the outline WITHOUT question text, the integrity settings and the resume point), `events` (client telemetry batch → `interview_integrity_events`; validated by `_shared/integrity-events.ts`, deduped on the client `event_id`, open/close intervals, 3000 rows per interview), `camera_exemption` (camera-required interview without a camera: reason + note), `flag` (the host's `flag_answer` → `interview_flags`), `disconnect`. | — |
| `create-realtime-session` | interview room (`createRealtimeSession`) | Mint an OpenAI Realtime client secret with the system prompt from `_shared/realtime-instructions.ts` (he / en / ar). **Requires `interviews.status = in_progress`**, is rate limited per interview (8 per 10 min, 40 total, counted from `system_events`) and acquires one `realtime` capacity slot per interview (`ai_capacity`; full pool → `503 at_capacity` + `retryAfterSeconds`). Adds the `flag_answer` tool when the assignment enables host flags, passes the conversation-care rules (silence nudges, own words) and a resume context after a drop. | `openai_realtime` |
| `save-interview-message` | `lib/realtime/interview-session.ts` | The only write path for `interview_messages`. Requires a running interview (90 s grace after completion), stores the room's per-turn timing under `metadata` (source = client) and dedupes by `clientId` (unique index). | — |
| `complete-interview` | `interview-session.ts` on `closing` | Idempotent completion, then the server-side integrity analysis (`_shared/integrity.ts`: session facts, timing extremes, verbatim overlap → `interview_flags`, summary in `interviews.metadata.integrity_summary`), releases the `realtime` capacity slot, then KICKS `grading-worker` (the DB trigger already queued the job). `GRADING_LEGACY_SYNC=1` restores the old synchronous `generate-report` + `evaluate-answer` calls. | — (legacy path: `openai_realtime2`) |
| `grading-worker` | `complete-interview` (kick), pg_cron via pg_net (tick) | Service-role only (role claim checked). Claims `grading_jobs` with a lease and runs the grading engine (`_shared/grading/*`): per-question evidence-verified evaluation, selective second pass, deterministic score, narrative, one-transaction persist. Retries with backoff / Retry-After, dead-letters, `options.provider = mock` for load tests. See `ARCHITECTURE.md` §9. | `openai_realtime2` |
| `generate-report` | student (recovery) / lecturer (forced re-run) | Thin wrapper: re-queues the grading job (`requeue_grading`) and kicks the worker. A student may only trigger it while no report exists; a lecturer of the course forces a NEW run. | — |
| `evaluate-answer` | student (recovery) / lecturer (forced re-run) | Same wrapper semantics as `generate-report` (kept for its callers). | — |
| `create-guest-session` | login screen ("continue as guest") | Service-role: create a one-shot guest auth user. **`verify_jwt=false` by design** (it is the login path). Rate limited per client address (6/h) and globally (150/h) through `rate_limit_events`. | service role |

All functions share `_shared/`: `cors.ts` (responses), `supabase.ts` (user +
service clients), `openai.ts` (Responses API wrapper, model table),
`grading/` (the grading engine: rubric, transcript, context, evidence, prompt,
provider, score, pipeline, rows, store-supabase, kick; tested under Node in
`tests/`),
`document-loader.ts`, `realtime-instructions.ts` (host prompt),
`integrity-settings.ts` (per-assignment feature flags, mirrored in
`lib/integrity/settings.ts`), `integrity-events.ts` (telemetry batch
validation + dedupe, Node-tested from `tests/integrity/`), `overlap.ts`
(verbatim-overlap check, mirrored in `lib/integrity/overlap.ts`),
`integrity.ts` (post-interview analysis),
`providers.ts` (mock providers, unused in production).

## Deploying

Use the Supabase MCP tool `deploy_edge_function` with the function's
`index.ts` **and every `_shared/*.ts` file it imports** (each deploy snapshots
its own copy of the shared files). Never redeploy for comment-only changes.

### Deployed versions (keep this table current)

| Slug | Deployed version | Matches repo? |
| --- | --- | --- |
| prepare-submission | v6 (2026-10-14) | yes — question pool + seeded selection, raw document text |
| interview-control | v2 (2026-10-16) | yes — event engine (event_id dedupe, open/close), camera_exemption, camera default `required` |
| create-realtime-session | v15 (2026-10-14) | **no — repo adds the `realtime` admission check (grading engine v2); deploy after migration 20260515000001** |
| save-interview-message | v5 (2026-10-14) | yes — status guard, timing metadata, clientId dedupe |
| evaluate-answer | v4 (2026-10-14) | **no — repo is the re-queue wrapper (v2 engine)** |
| complete-interview | v5 (2026-10-14) | **no — repo kicks `grading-worker` instead of calling the siblings** |
| generate-report | v7 (2026-10-14) | **no — repo is the re-queue wrapper (v2 engine)** |
| grading-worker | not deployed | new |
| create-guest-session | v2 (2026-10-14) | yes — rate limit |

### Grading engine v2 deploy order (not yet done; owner approval required)

1. `apply_migration` `20260515000001_grading_engine.sql` (additive; the
   trigger starts queueing jobs that wait for a worker).
2. Deploy `grading-worker` (`index.ts` + `_shared/cors.ts`, `supabase.ts`,
   `openai.ts`, `overlap.ts`, `grading/*.ts`), `verify_jwt = true`.
3. Deploy `complete-interview`, `evaluate-answer`, `generate-report`
   (each with `_shared/grading/kick.ts` and its other imports), then
   `create-realtime-session`.
4. In SQL: `select vault.create_secret('https://jxlrpewoqikpswxmtdma.supabase.co', 'project_url');`
   and `select vault.create_secret('<service_role_key>', 'service_role_key');`
   then `apply_migration` `20260515000002_grading_cron.sql`.
5. Set `ai_capacity.realtime.max_concurrent` from the verified OpenAI tier
   (`node bench/grading/run.ts --probe` prints the rate-limit headers).
6. Rollback: `update grading_config set queue_enabled = false`, redeploy
   the previous function versions or set `GRADING_LEGACY_SYNC=1` on
   `complete-interview`.

Note (2026-10-16): `_shared/integrity-settings.ts` changed (camera default
`required`, `headPose`). Only `interview-control` v2 carries the new copy;
`create-realtime-session`, `complete-interview` and `prepare-submission`
still bundle the old one, which is harmless for them (they do not read
`camera` / `headPose`) but means their next deploy picks up the change.

History: on 2026-10-01 the deployed v12 of `create-realtime-session` and v5 of
`generate-report` had drifted from the repo (condensed prompt, two extra scoring
lines). Both were reconciled by deploying the repo versions (with the new
features) as v13 / v6. Before any future change, pull the live source with the
MCP tool `get_edge_function` and diff it against the repo first.

## Known limits (see `ARCHITECTURE.md` §7 and §8)

- The Realtime data channel is browser-to-OpenAI: text the browser injects
  (the room's system notes) is indistinguishable, server-side, from text a
  modified client injects. The transcript is therefore client telemetry; the
  server facts that cannot be forged are the session mints, the status
  transitions and the timestamps (`_shared/integrity.ts`).
- `create-guest-session` is rate limited but still has no CAPTCHA.
