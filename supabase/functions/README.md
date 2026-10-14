# Edge Functions

Deno functions deployed to Supabase project `podtask` (`jxlrpewoqikpswxmtdma`).
They are excluded from the repo's `tsc`/`eslint` gates and Deno is not installed
locally, so **there is no local gate for this folder**: review carefully and
deploy one function at a time.

## Functions

| Slug | Called from | Purpose | Secrets |
| --- | --- | --- | --- |
| `prepare-submission` | processing screen (`prepareSubmissionInvokeSb`) | Parse the uploaded file, analyze it, write a POOL of 12 typed questions (`kind`, verbatim `anchor`, `key_points`) and a seeded selection of 5 (`plan.questions`; the pool stays in `plan.pool`), store the raw document text (TXT/DOCX) for the overlap check, create the `interviews` row. Idempotent once `interview_ready`. | `openai_realtime2` |
| `interview-control` | room page (`startInterviewSb`), consent screen, the room's telemetry queue | Service-role state changes for the student side: `consent` (records the integrity notice acknowledgement), `start` (ready → in_progress or resume; requires the consent when the assignment asks for one; returns the outline WITHOUT question text, the integrity settings and the resume point), `events` (client telemetry batch → `interview_integrity_events`), `flag` (the host's `flag_answer` → `interview_flags`), `disconnect`. | — |
| `create-realtime-session` | interview room (`createRealtimeSession`) | Mint an OpenAI Realtime client secret with the system prompt from `_shared/realtime-instructions.ts` (he / en / ar). **Requires `interviews.status = in_progress`** and is rate limited per interview (8 per 10 min, 40 total, counted from `system_events`). Adds the `flag_answer` tool when the assignment enables host flags, passes the conversation-care rules (silence nudges, own words) and a resume context after a drop. | `openai_realtime` |
| `save-interview-message` | `lib/realtime/interview-session.ts` | The only write path for `interview_messages`. Requires a running interview (90 s grace after completion), stores the room's per-turn timing under `metadata` (source = client) and dedupes by `clientId` (unique index). | — |
| `complete-interview` | `interview-session.ts` on `closing` | Idempotent completion, then the server-side integrity analysis (`_shared/integrity.ts`: session facts, timing extremes, verbatim overlap → `interview_flags`, summary in `interviews.metadata.integrity_summary`), then `generate-report` + `evaluate-answer` in parallel. | `openai_realtime2` |
| `generate-report` | `complete-interview` | Build the student-facing report (rubric, gaps, recommendations) in the interview language. Drops the room's `[SYSTEM NOTE]` lines, explains `discarded_utterance:<kind>` lines to the scorer and tells it to credit only content about this submission. Knows nothing about integrity. | `openai_realtime2` |
| `evaluate-answer` | `complete-interview` | Per-question KNOWLEDGE evaluation (gpt-4.1-mini, one call) → `answer_evaluations`. Told never to speculate about aids; lecturer-only via RLS. | `openai_realtime2` |
| `create-guest-session` | login screen ("continue as guest") | Service-role: create a one-shot guest auth user. **`verify_jwt=false` by design** (it is the login path). Rate limited per client address (6/h) and globally (150/h) through `rate_limit_events`. | service role |

All functions share `_shared/`: `cors.ts` (responses), `supabase.ts` (user +
service clients), `openai.ts` (Responses API wrapper, model table),
`document-loader.ts`, `realtime-instructions.ts` (host prompt),
`integrity-settings.ts` (per-assignment feature flags, mirrored in
`lib/integrity/settings.ts`), `overlap.ts` (verbatim-overlap check, mirrored
in `lib/integrity/overlap.ts`), `integrity.ts` (post-interview analysis),
`providers.ts` (mock providers, unused in production).

## Deploying

Use the Supabase MCP tool `deploy_edge_function` with the function's
`index.ts` **and every `_shared/*.ts` file it imports** (each deploy snapshots
its own copy of the shared files). Never redeploy for comment-only changes.

### Deployed versions (keep this table current)

| Slug | Deployed version | Matches repo? |
| --- | --- | --- |
| prepare-submission | v6 (2026-10-14) | yes — question pool + seeded selection, raw document text |
| interview-control | v1 (2026-10-14) | yes |
| create-realtime-session | v15 (2026-10-14) | yes — status guard, mint rate limit, flag_answer, conversation-care prompt, resume |
| save-interview-message | v5 (2026-10-14) | yes — status guard, timing metadata, clientId dedupe |
| evaluate-answer | v4 (2026-10-14) | yes — real per-question evaluation |
| complete-interview | v5 (2026-10-14) | yes — idempotent, integrity analysis, parallel report + evaluation |
| generate-report | v7 (2026-10-14) | yes — interview-language output, relevance rules, discarded_utterance lines |
| create-guest-session | v2 (2026-10-14) | yes — rate limit |

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
