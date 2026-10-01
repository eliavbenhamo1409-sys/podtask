# Edge Functions

Deno functions deployed to Supabase project `podtask` (`jxlrpewoqikpswxmtdma`).
They are excluded from the repo's `tsc`/`eslint` gates and Deno is not installed
locally, so **there is no local gate for this folder**: review carefully and
deploy one function at a time.

## Functions

| Slug | Called from | Purpose | Secrets |
| --- | --- | --- | --- |
| `prepare-submission` | processing screen (`prepareSubmissionInvokeSb`) | Parse the uploaded file, analyze it, build the 5-question plan, create the `interviews` row. Idempotent once `interview_ready`. | `openai_realtime2` |
| `create-realtime-session` | interview room (`createRealtimeSession`) | Mint an OpenAI Realtime client secret with the system prompt from `_shared/realtime-instructions.ts` and the `finish_interview` tool. | `openai_realtime` |
| `save-interview-message` | `lib/realtime/interview-session.ts` | Insert one `interview_messages` row (host or student). | — |
| `complete-interview` | `interview-session.ts` on `closing` | Mark interview/submission completed, run the gpt-4.1 scoring, write `reports`. | `openai_realtime2` |
| `generate-report` | `/complete` page polling | Build the student-facing report (rubric, gaps, recommendations). | `openai_realtime2` |
| `create-guest-session` | login screen ("continue as guest") | Service-role: create a one-shot guest auth user. **`verify_jwt=false` by design** (it is the login path). | service role |
| `evaluate-answer` | nobody | Dormant mock scorer kept from the first iteration. | — |

All functions share `_shared/`: `cors.ts` (responses), `supabase.ts` (user +
service clients), `openai.ts` (Responses API wrapper, model table),
`document-loader.ts`, `realtime-instructions.ts` (host prompt),
`providers.ts` (mock providers, unused in production).

## Deploying

Use the Supabase MCP tool `deploy_edge_function` with the function's
`index.ts` **and every `_shared/*.ts` file it imports** (each deploy snapshots
its own copy of the shared files). Never redeploy for comment-only changes.

### Deployed versions (keep this table current)

| Slug | Deployed version | Matches repo? |
| --- | --- | --- |
| prepare-submission | v5 | yes |
| create-realtime-session | v13 (2026-10-01) | yes — repo prompt + system-notes / skip / swap protocol |
| save-interview-message | v4 | yes |
| evaluate-answer | v3 | no (dormant) |
| complete-interview | v4 | yes |
| generate-report | v6 (2026-10-01) | yes — grouped transcript + skip penalty / swap handling |
| create-guest-session | v1 | yes |

History: on 2026-10-01 the deployed v12 of `create-realtime-session` and v5 of
`generate-report` had drifted from the repo (condensed prompt, two extra scoring
lines). Both were reconciled by deploying the repo versions (with the new
features) as v13 / v6. Before any future change, pull the live source with the
MCP tool `get_edge_function` and diff it against the repo first.

## Known defects (see `ARCHITECTURE.md` §7)

- `create-realtime-session` has no `interviews.status` guard → unbounded secret
  minting.
- `complete-interview` is not idempotent → a second call regresses
  `submissions.status`.
- `prepare-submission` ignores DB write errors on its critical path.
- `create-guest-session` has no rate limit / CAPTCHA.
