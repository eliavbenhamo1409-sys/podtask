# Podtask — architecture map

Read `CLAUDE.md` first for the one-paragraph brief. This file is the map an
engineer or agent needs before touching the pipeline.

## 1. The pipeline

```
upload (browser)            prepare-submission (edge)                 interview room (browser)                 after the interview (edge)
──────────────────────      ────────────────────────────────────      ─────────────────────────────────────    ─────────────────────────────
student picks a file   →    submissions.status:                  →    create-realtime-session mints an    →    complete-interview marks the
submissions row created     uploaded → parsing → parsed →             OpenAI Realtime client secret;           interview completed and scores
file → Storage bucket       analyzing → analysis_ready →              browser opens WebRTC directly to         it (gpt-4.1) → reports row
                            interview_ready                           OpenAI; host speaks first.               (status report_ready).
                            + document_parses, document_analyses,     Every host/student utterance is          generate-report builds the
                            interviews (status ready),                saved via save-interview-message.        student-facing rubric/report.
                            interview_plans (5 questions)
```

Processing is polled by `submissions/[id]/processing` (`observeSubmissionProcessing`
in `lib/student/student-service.ts`): it invokes `prepare-submission`, subscribes
to Postgres changes on the submission row and falls back to polling.

## 2. The four status vocabularies (`lib/student/status.ts`)

| Vocabulary | Lives on | Written by | Meaning |
| --- | --- | --- | --- |
| `submission_status` | `submissions.status` | `prepare-submission`, `complete-interview`, `generate-report` | Where the file is in the pipeline. `failed` carries `failure_reason`. |
| `interview_status` | `interviews.status` | `prepare-submission` (ready), `startInterviewSb` (in_progress), `complete-interview` (completed) | Lifecycle of the interview row. |
| `interview_runtime_state` | `interviews.current_state` + the browser FSM in `lib/realtime/interview-session.ts` | browser | Second-by-second state of the room (`host_intro`, `ai_speaking`, `student_turn`, …, `closing`, `completed`). |
| `student_assignment_status` | derived only (never stored) | `projectAssignmentStatus` in `student-service-supabase.ts`, mock data | What the dashboard card shows: `upload_required`, `processing`, `ready_for_interview`, `mic_test_required`, `interview_in_progress`, `completed`, `failed`. |

Derivation rules:
- submission `uploaded…analysis_ready` → assignment `processing`; `interview_ready` → `ready_for_interview`; `interview_completed`/`report_ready` → `completed`; `failed` → `failed`; no submission → `upload_required`.
- Route for a card: `lib/student/routing.ts` (`nextRouteForAssignment`).
- Processing screen step: `processingStepFor` in `status.ts`.

The enums are hand-mirrored from `lib/supabase/database.types.ts`; keep them in
sync when a migration changes an enum.

## 3. Modes

| Flag | Where it lives | Effect |
| --- | --- | --- |
| `NEXT_PUBLIC_MOCK_MODE` | `lib/env.ts` → `MOCK_MODE` | **Mock is the default**; only the literal `"false"` enables Supabase. Mock serves `lib/student/mock-data.ts` and skips auth in the middleware. Even in real mode, non-UUID ids (`a1`, `int-a4`, `self-…`) stay on mock (`isUuidLike`). |
| `NEXT_PUBLIC_REALTIME_ADAPTER` | `lib/env.ts` → `REALTIME_ADAPTER` | `"openai"` = real WebRTC voice session; anything else = timer-driven mock FSM in the room. |

## 4. The interview room (`app/[locale]/student/interviews/[interviewId]/`)

- `page.tsx` loads the interview + plan (server) and marks it `in_progress`.
- `interview-client.tsx` is the stateful room; its file header documents the
  mode rule, the two drivers and the three close paths.
- `interview-parts.tsx` holds the hook-free presentational pieces.
- `lib/realtime/openai-adapter.ts` wraps WebRTC + the Realtime event stream.
- `lib/realtime/interview-session.ts` is the FSM (`TRANSITIONS`) plus the
  persistence side effects (`saveInterviewMessage`, `completeInterview`).
- `lib/realtime/host-text-heuristics.ts` infers question progress and closing
  from the host's words. **Its ordinal words and farewell phrases must match
  the prompt in `supabase/functions/_shared/realtime-instructions.ts`.**

Close paths (all end in `session.close()` → FSM `closing` → redirect to
`/complete`): the `finish_interview` tool call (waits for the farewell audio),
the closing-phrase watchdog, and the final-answer fallback.

## 5. Data layer (`lib/student/`)

| File | Runtime | Role |
| --- | --- | --- |
| `student-service.ts` | browser (`"use client"` callers) | Public API for client components. Dispatches per call to mock data or to `student-service-supabase.ts` (lazy import). |
| `student-service-server.ts` | server components | Same dispatch for RSC pages, using the cookie-bound Supabase server client. |
| `student-service-supabase.ts` | both | The real queries + row → UI mapping (`rowToSubmission`, `rowToProfile`, …). |
| `mock-data.ts` | both | Mutable in-memory demo fixtures (`a1`–`a4`, `int-a4`, …). |
| `status.ts`, `routing.ts`, `types.ts` | both | Vocabularies, card routing, UI types. |

The two dispatchers are maintained by hand; when you add a function, add it to
both (or only to the one whose runtime needs it) and keep the mock branch.

## 6. Tooling and deploy

- Gates: `npm run check` (= `tsc --noEmit` + `eslint .`), `npm run build`.
  There is no test suite; the gates plus a manual walkthrough are the safety net.
- Web deploy: `scripts/deploy.sh` (clean tree → check → push `main` → wait for
  Vercel). Edge functions: Supabase MCP, see `supabase/functions/README.md`.

## 7. Known issues (audit, 2026-10-01) — not fixed, owner decision needed

1. **Repo ≠ production for two edge functions.** The deployed
   `create-realtime-session` and `generate-report` differ from the repo
   (prompt text / scoring lines). Redeploying from the repo silently changes
   live model behaviour. Reconcile before any redeploy (`supabase/functions/README.md`).
2. **`create-realtime-session` has no status guard.** One interview minted
   1,677 client secrets; the lobby/room can re-invoke it freely. Add a guard
   on `interviews.status` and/or a rate limit.
3. **`complete-interview` is not idempotent.** A second call regresses
   `submissions.status` from `report_ready` to `interview_completed` and
   overwrites `completed_at`/`duration_seconds`.
4. **Live mode never advances `questionIndex` in the FSM**, so every persisted
   message is bound to the first plan question; `generate-report` groups by it.
5. **Student answers may be persisted twice** (both `conversation.item.done`
   and `input_audio_transcription.completed` carry the text).
6. **Real-mode dashboard cards all link to `/upload`**: the server pages resolve
   card routes through mock-data lookups that return `undefined` for UUIDs.
7. **`create-guest-session` is unauthenticated** and creates real auth users
   with no CAPTCHA or rate limit.
8. **Visible-but-small UI bugs:** the student avatar initial in the room is
   sliced from a translated greeting (blank in Hebrew); `Link` wrapping
   `button` in two cards is invalid HTML; `animation: pulse` references a
   keyframe that doesn't exist.
9. **Uncommitted rewrite of `supabase/migrations/20260506000003_anonymous_auth_support.sql`**
   in the working tree contradicts the version already applied in production.
10. `evaluate-answer` and `_shared/providers.ts` are dormant mock code that is
    still deployed; `podtask 2/` is the static design prototype.
