# Podtask — architecture map

Read `CLAUDE.md` first for the one-paragraph brief. This file is the map an
engineer or agent needs before touching the pipeline.

## 1. The pipeline

```
upload (browser)            prepare-submission (edge)                 interview room (browser)                 after the interview (edge + queue)
──────────────────────      ────────────────────────────────────      ─────────────────────────────────────    ─────────────────────────────
student picks a file   →    submissions.status:                  →    create-realtime-session mints an    →    complete-interview marks the
submissions row created     uploaded → parsing → parsed →             OpenAI Realtime client secret;           interview completed; a DB trigger
file → Storage bucket       analyzing → analysis_ready →              browser opens WebRTC directly to         queues a grading job (outbox);
                            interview_ready                           OpenAI; host speaks first.               grading-worker grades it with the
                            + document_parses, document_analyses,     Every host/student utterance is          versioned engine (§9) → reports
                            interviews (status ready),                saved via save-interview-message.        row (status ready, report_ready).
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
  the prompt in `supabase/functions/_shared/realtime-instructions.ts`**, for
  all three interview languages (he / en / ar).
- `lib/realtime/student-text-guard.ts` judges every final student transcript
  before the room counts it as an answer: a turn with no words in the
  interview language's script (`off_language`, judged per word so Hebrew
  sentences full of Latin tool names still pass; fewer than four words are
  never judged) or a transcription artefact (`noise`: a "thank you for
  watching"-style phrase that is the whole turn, looping words, a near-full
  echo of the transcription prompt, an empty transcript) is recorded as a
  `discarded_utterance:<kind>` system message, never counted, and the host is
  told through a `[SYSTEM NOTE]` (`buildUnintelligibleDirective`) not to
  build on it. The note is skipped while the student is already speaking the
  real answer and once the farewell has started. The farewell the room requests is grounded the same way:
  `buildFarewellInstructions` gets the assignment title and whether any
  usable answer was captured, so a dead microphone ends with a neutral
  goodbye instead of an invented recap.

### Interview language

The student picks the interview language in the lobby
(`InterviewLanguagePicker` → `setInterviewLanguage` → `interviews.language`,
owner RLS, only while the interview is `created` / `ready`). It is independent
of the UI locale. `create-realtime-session` reads it first (the assignment
language is only the fallback), builds the prompt for it, pins the input
transcription to it (`audio.input.transcription.language` + a short
vocabulary `prompt`), enables input noise reduction (`far_field` by default,
`assignments.settings.noise_reduction` overrides) and returns it to the room,
which uses it for every heuristic, directive, caption rate and text direction.
The plan and analysis stay in the assignment language (he / en); for an
Arabic interview the host is told to ask them in Arabic in its own words.
`generate-report` writes the report in the interview language.

Observed live (2026-10-14): with the transcription pinned, speech in another
language comes back as a translation into the interview language (an English
answer in a Hebrew interview was transcribed as Hebrew), so the transcript is
single-language by construction and the `off_language` verdict mostly catches
transcriber artefacts. The host is instructed to ask for the interview
language when it hears another one, but that is best-effort: in the live run
it simply answered the translated content in Hebrew. White noise at a
realistic level did not open a turn at all (noise reduction + VAD threshold).

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

## 6b. Performance model (2026-10-06)

Supabase (Postgres + Auth) lives in Tokyo. Every round trip to it costs
~200 ms from Vercel's default Washington region and ~300 ms from a browser in
Israel, so latency is dominated by the NUMBER OF SEQUENTIAL ROUND TRIPS, not by
rendering. Rules that keep pages fast:

- `vercel.json` pins server functions to `hnd1` (Tokyo): a query is ~5 ms
  there. The visitor pays one Tokyo round trip per page instead of one per
  query. (Moving the Supabase project to eu-central would make everything
  faster for Israeli users; it needs a new project + data migration.)
- Identity is read from the session JWT and verified locally with the
  project's ES256 key (`auth.getClaims()`), both in the middleware and in
  `student-service-supabase.ts`; never `auth.getUser()` on a hot path.
- Server reads in `student-service-server.ts` are wrapped in React `cache()`
  so `generateMetadata` and the page body share one fetch per request.
- Independent queries go through `Promise.all`; `getAssignmentByIdSb` queries
  by id instead of loading every assignment.
- The browser never calls Supabase just to render chrome: the top-bar avatar
  initial is cached per tab (`lib/student/profile-initial.ts`), and the login
  screen loads the Supabase SDK after first paint.
- The root layout preconnects to the Supabase origin for the browser-side
  calls (upload, realtime session, transcript).

## 7. Known issues (audit, 2026-10-01) — not fixed, owner decision needed

1. ~~Repo ≠ production for two edge functions.~~ Reconciled 2026-10-01
   (`create-realtime-session` v13, `generate-report` v6 deployed from the repo).
2. ~~`create-realtime-session` has no status guard.~~ Fixed 2026-10-14: requires
   `in_progress` and is rate limited per interview (see §8).
3. ~~`complete-interview` is not idempotent.~~ Fixed 2026-10-14.
4. ~~Live mode never advances `questionIndex`.~~ Fixed 2026-10-01: the room
   mirrors the host's ordinal announcements into the FSM and binds persisted
   messages to the detected plan question.
5. **Student answers may be persisted twice** (both `conversation.item.done`
   and `input_audio_transcription.completed` carry the text). The guard note
   to the host is rate-limited (4 s) so a double event sends one note.
6. **Real-mode dashboard cards all link to `/upload`**: the server pages resolve
   card routes through mock-data lookups that return `undefined` for UUIDs.
7. **`create-guest-session` is unauthenticated** and creates real auth users;
   rate limited since 2026-10-14 (6 per address per hour, 150 global), still
   no CAPTCHA.
8. **Visible-but-small UI bugs:** the student avatar initial in the room is
   sliced from a translated greeting (blank in Hebrew); `Link` wrapping
   `button` in two cards is invalid HTML; `animation: pulse` references a
   keyframe that doesn't exist.
9. **Uncommitted rewrite of `supabase/migrations/20260506000003_anonymous_auth_support.sql`**
   in the working tree contradicts the version already applied in production.
10. `_shared/providers.ts` is dormant mock code; `podtask 2/` is the static
    design prototype. (`evaluate-answer` / `generate-report` are thin
    re-queue wrappers since §9.)

## 8. Integrity system and lecturer dashboard (2026-10-14)

Goal: fewer opportunities for outside help during the interview without
turning it into an interrogation. Every signal is EVIDENCE for a human
reviewer; nothing fails a student automatically.

### Trust model

| Layer | Written by | Trust |
| --- | --- | --- |
| `interviews.status`, `started_at`, `completed_at`, `metadata.attempts` | `interview-control` / `complete-interview` (service role) | server fact |
| `system_events` `realtime.client_secret.created` | `create-realtime-session` | server fact (session count) |
| `interview_messages` (+ `metadata` timing) | `save-interview-message`, from the room | **client telemetry**: the browser owns the OpenAI data channel |
| `interview_integrity_events` (`source = client`) | `interview-control` `events`, from the room | client telemetry |
| `interview_integrity_events` (`source = server`) | `interview-control` (`session_resumed`) | server fact |
| `interview_flags` `host_tool` | the host's `flag_answer` tool, relayed by the room | host impression, client-relayed |
| `interview_flags` `server_*` | `complete-interview` → `_shared/integrity.ts` | server analysis over stored rows |
| `answer_evaluations` | `evaluate-answer` | knowledge only, never integrity |

Students can no longer insert transcript rows directly, read the plan before
the interview is over, or change interview / submission status
(`20260514000002_integrity_lockdown.sql`: policies + `guard_*` triggers).
Profiles: `guard_profile_self_update` blocks role / institution changes
from PostgREST; a lecturer role is granted by SQL only.

### Student flow (what changed)

lobby → **consent** (`/student/submissions/:id/consent`, acknowledgement
recorded server-side, version `CONSENT_VERSION`) → mic + camera check →
room. The room page calls `interview-control` `start` (ready → in_progress,
or resume), which returns the outline (ids + topics, no text), the resolved
`IntegritySettings` and the resume point. The room then:

- attaches per-turn timing to each persisted answer (`lib/integrity/types.ts`
  `TurnTimingMetadata`: latency from the host's playback stop, speech length,
  barge-in, mute toggles, hidden/blur counters) with a `clientId` for dedupe;
- runs `ActivityMonitor` (visibility, blur, fullscreen, pagehide, offline)
  and `CameraMonitor` (self-view + MediaPipe Face Landmarker on-device in a
  Web Worker: face count and head orientation only, no frames leave the
  browser; the wasm runtime is loaded from jsDelivr, the model from
  `/models/face_landmarker.task`, see the exam-integrity section below)
  and ships events through `IntegrityEventQueue`;
- nudges gently after `silenceNudgeSeconds` of silence on the student's turn
  (two per question at most, `buildSilenceNudgeDirective`), and asks once for
  the idea "in your own words" when an answer matches the submitted text
  (`lib/integrity/overlap.ts`, `buildOwnWordsDirective`);
- relays the host's `flag_answer` calls, reports disconnects, and resumes
  from the last question after a reload (`buildResumeDirective`).

Feature flags live in `assignments.settings.integrity` and are resolved by
`resolveIntegritySettings` (camera off/on/required, activity monitoring,
silence nudge seconds, overlap check, host flags, per-answer evaluation,
consent). Personal (self-initiated) assignments default to no camera and no
activity telemetry, except for guest (demo) accounts: a guest gets the
lecturer defaults even on the PERSONAL course, because the guest path is where
the whole integrity flow is exercised while there are no real users
(`isGuestIdentity`, resolved identically by the app and `interview-control`).

### Exam integrity layer (2026-10-16): tab monitoring + camera proctoring

Built on the telemetry above; nothing here changes the knowledge score.

- **Event engine** (`lib/integrity/types.ts`, `_shared/integrity-events.ts`,
  migration `20260516000001_integrity_event_engine.sql`): every event carries
  a client UUID (`event_id`, unique per interview) and a `client_seq`.
  Interval kinds (`visibility_hidden`, `face_missing`, `multiple_faces`,
  `head_away`, `tracking_unavailable`) are sent twice under the same id:
  once when they open, once when they close. `interview-control` upserts
  with ignore-duplicates and then fills `ended_at` on rows still open, so a
  browser that dies mid-interval leaves the start behind and a retried or
  re-sent batch never duplicates. `created_at` is the server-received time.
  Per-interview cap 3000 rows (429 → the room drops the batch). Spec names:
  TAB_HIDDEN/TAB_RETURNED = `visibility_hidden` + `tab_returned`,
  CAMERA_DISCONNECTED = `camera_off`, CAMERA_PERMISSION_DENIED =
  `camera_denied`, NO_FACE = `face_missing`, HEAD_AWAY = `head_away`.
- **Queue** (`IntegrityEventQueue`): batches of ≤ 50 every 4 s, retry with
  backoff on network / 5xx, drop on 4xx, re-flush on `online`, unsent buffer
  mirrored to `sessionStorage` and re-sent after a reload (same ids), one
  keepalive batch on `pagehide`. Sync state feeds the room's badge.
- **Tab monitoring** (`ActivityMonitor`): `visibilitychange` is the source
  of truth; a hidden episode shorter than 300 ms is flicker and dropped;
  `blur` alone is a `window_blur` (≥ 1.5 s) and never a tab exit;
  `pagehide` closes an open episode without a return. The room shows
  "✓ ניטור הבחינה פעיל" with a live exit counter and a calm notice on
  return (a firmer reminder from the third exit; nothing is ever failed).
- **Camera** (`CameraMonitor` + `face-worker.ts` + `PresenceTracker` +
  `head-pose.ts`): MediaPipe Face Landmarker (model vendored at
  `public/models/face_landmarker.task`, wasm from jsDelivr) runs in a Web
  Worker on 320×240 bitmaps at ~2 fps, adaptive down to 0.5 fps when
  inference is slow; main-thread fallback when workers are unavailable. The
  worker returns only a face count, yaw/pitch and a coarse eye direction
  (three blendshape sums, `live-warning.ts`). Filters: no face ≥ 5 s
  opens `face_missing`, closes after 0.8 s of presence; ≥ 2 faces for ≥ 2 s
  opens `multiple_faces`; |yaw| ≥ 35° or |pitch| ≥ 30° for ≥ 4 s opens
  `head_away` (hysteresis 25°/20°, 1.5 s to close). Camera integrity:
  track `ended` → `camera_off`, track muted ≥ 3 s → `camera_off`
  (reason muted), no new frames for 4 s or a detector failure →
  `tracking_unavailable` (distinct from "no face"). Mic-test: device picker,
  frame check, and a recorded **camera exemption** (reason + note, action
  `camera_exemption`) for camera-required interviews. Default for lecturer
  assignments is now `camera: "required"` (`settings.integrity.camera`
  relaxes it; `head_pose: false` disables orientation).
- **Live warning sign** (`lib/integrity/live-warning.ts`,
  `LiveWarningMonitor`, fed by `CameraMonitor`): an amber frame + short
  text on the self-view, with a soft two-note chime
  (`warning-chime.ts`), only on reasonable suspicion: head or eyes off the
  screen for 5 s in a row (`look_away`), 12 s off the screen across ≥ 3
  looks within 30 s (`glances`), a `multiple_faces` or `face_missing`
  interval open. "Off the screen" is measured against the student's own
  running-median baseline (learned only from on-screen samples after a
  15-sample warm-up); eyes alone count only while the head is near its
  baseline, a moderately turned head plus eyes further the SAME way counts
  (`PITCH_DOWN_SIGN`, `YAW_EYE_SAME_SIGN` encode the sign conventions),
  eyes counter-rotating against the head never do, looking up is ignored,
  and a nearly closed eye (blink ≥ 0.8) is skipped rather than read. Each
  appearance is stored once per reason per 20 s as `integrity_warning`
  (payload `reason`, `cue` head/eyes/both, `away_ms`, `episodes`) and the
  lecturer sees it as "needs a check". `?proctorDebug=1` prints the raw
  readings under the self-view.
- **Lecturer** (`components/lecturer/exam-integrity.tsx`,
  `lib/lecturer/exam-integrity.ts`): "Exam Integrity" panel with counts,
  away time, camera state / exemption, a three-lane timeline with question
  marks, and every event classified technical / monitoring / needs a check
  (hidden ≥ 10 s, no face ≥ 20 s, head away ≥ 10 s, any multiple faces, or
  an interval that never closed). Copy insists on a human check.
- **Privacy**: no frames, landmarks or embeddings leave the worker; no
  video is recorded; students cannot read any events (no select policy);
  retention hook `purge_interview_integrity_events(interval)` (not
  scheduled). Limits stated to the student and the lecturer: second device,
  split screen, virtual camera and gaze are not detectable.
- **Tests**: `node --experimental-transform-types --import
  ./tests/integrity/register.mjs --test "tests/integrity/*.test.ts"`.

### Lecturer side

`/[locale]/lecturer` (layout = role gate on `profiles.role`), dashboard
(courses, assignments, counts, create course / assignment, enrol students by
e-mail through `lecturer_create_course` / `lecturer_add_course_members`),
assignment page (roster with status, score, flags, review state), interview
report (score + rubric, per-question answers with the knowledge evaluation,
integrity signals with limitations, browser/camera events, transcript, review
panel → `interview_reviews`). Data layer: `lib/lecturer/*`; all reads run
under the lecturer's session and the lecturer RLS policies.

## 9. Grading engine v2 and the grading queue (2026-10-14)

Code: `supabase/functions/_shared/grading/*` (runtime-neutral: Deno in the
edge functions, Node in `tests/`, `bench/`, `load/`), `grading-worker`,
migrations `20260515000001_grading_engine.sql`, `20260515000002_grading_cron.sql`,
`20260515000003_grading_capacity.sql`. In production since 2026-10-15.

### One source of truth for the score

| step | where | what |
| --- | --- | --- |
| material | `transcript.ts` | per planned question: student turns (directives / echoes / discarded turns removed), host turns (first = question, rest = follow-ups), `skipped_question:N` / `replaced_question:N` markers (by `plan_question_id`, else ordinal), technical signals (disconnects, resumes, mint failures). |
| context | `context.ts` | the two document chunks that overlap the question's anchor / key points most (lexical, deterministic). The document checks claims; it never stands in for the spoken answer. |
| evaluation | `prompt.ts` + `provider.ts` | ONE strict-JSON call per answered question: `answer_status` (correct / partially_correct / vague / incorrect / missing / unassessable), six criterion scores 0-5 against the anchors in `rubric.ts`, correct facts, errors, missing points, verbatim evidence quotes, rationale, confidence, uncertainty reasons. |
| evidence check | `evidence.ts` | every quote must be found as one contiguous token run (≥ 80 %) in the student's own turns for that question (same normaliser as the overlap check); otherwise it is kept but `verified: false`. |
| score | `score.ts` (pure) | question score = weighted mean of the criteria APPLICABLE to the question's kind (`KIND_WEIGHTS`; e.g. no `application` for a concept question) → 0-100. Overall = mean of question scores (skipped = 0, counted once; replaced = normal; unanswered = 0, or excluded + human review when the interview shows technical trouble; `unassessable` = excluded). Four display dimensions from a one-to-one criterion map (conceptual ← accuracy, relevance; reasoning ← application, consistency; evidence ← process; communication ← explanation). Levels 0-49/50-69/70-84/85-100 unchanged. |
| second pass | `pipeline.ts` | independent re-evaluation (no exposure to pass 1) when: evidence unverified with credit ≥ 40, low confidence, status/score contradictions, the question could flip the overall level (±10), or a 10 % QA sample. ≤ 20 points apart → averaged; otherwise pass 1 is kept as provisional and the report is `requires_human_review`. No tiebreak judge until the benchmark shows it helps. |
| narrative | `prompt.ts` | one call that explains the computed numbers and may not change them; deterministic fallback text (he/en/ar) when nothing was assessable or the call fails. |
| persistence | `persist_grading_result` | one transaction: `grading_runs` → succeeded, `answer_evaluations` replaced (legacy columns + provenance), `reports` upserted on `submission_id`, `submissions.status = report_ready`, job done, `report.generated` event. |

Reproducibility: every run stores rubric / prompt / scoring versions, models,
params, provider, the canonical SHA-256 `input_hash`, the evaluations, the
computed result, usage and timings. The same input with the same versions
reuses the stored run with no model call; a forced re-grade is a new
`run_no`, never an overwrite. `reports.rubric_result` keeps its four keys +
`overall_score` + `skipped_questions` + `replaced_questions` and gains a
provenance block (`engine: v2`, versions, `grading_run_id`,
`requires_human_review`, `review_reasons`, `confidence`, `coverage`,
`question_scores`).

### Durable queue

- `interviews.status → completed` fires `enqueue_grading_on_complete`, which
  inserts the `grading_jobs` row in the same transaction (outbox). Unique per
  interview. `grading_config.queue_enabled` is the switch;
  `reconcile_since` keeps old interviews out.
- `complete-interview` only KICKS `grading-worker` (service role, `waitUntil`
  when available). `GRADING_LEGACY_SYNC=1` restores the old synchronous path.
- `claim_grading_jobs` = `FOR UPDATE SKIP LOCKED` + lease; a worker extends
  its lease every 45 s; an expired lease is reclaimed; `fail_grading_job`
  applies 15 s·2ⁿ backoff with jitter (or the provider's Retry-After), dead
  letter at `max_attempts`; `reconcile_grading` (cron, 5 min) queues
  completed interviews without a job, re-queues done jobs whose report is
  missing, expires leases and capacity slots.
- pg_cron ticks `private.grading_tick` every 10 s; it POSTs to the worker
  only when there is something to claim, fanning out up to 8 invocations by
  backlog. The request carries `x-grading-token`, a random token the
  migration generated in Vault; the worker (deployed with
  `verify_jwt = false`) accepts only that token or the exact service-role key.
- One `worker` capacity slot per invocation (pool full → the invocation
  returns at once). Inside it, `worker_batch` lanes (2) each grade a job and
  keep claiming the next one for 120 s, so a backlog drains without waiting
  for ticks. A wait for model capacity hands the job back with
  `defer_grading_job` (no attempt spent; the run stays resumable).
- Interrupted runs resume from their checkpointed evaluations; a run that
  lost its lease to a newer run is `superseded` and cannot publish.
- `grading_status(interview_id)` (owner / lecturer) exposes job status,
  stage, attempts and a sanitised error code; the report page polls it.

### Global concurrency gate

`ai_capacity` pools with `acquire_ai_slot` / `release_ai_slot` leases in
Postgres (row lock per pool, TTL expiry). Production values (2026-10-15):

| pool | max | basis |
| --- | --- | --- |
| `realtime` | 12 | last measured OpenAI Realtime limit (200k TPM); not re-verified |
| `evaluate` | 40 | gpt-4.1 2M TPM measured from response headers; one busy slot ≈ 35k TPM |
| `verify` | 16 | shares the gpt-4.1 budget |
| `narrative` | 16 | gpt-4.1-mini 10M TPM measured |
| `prepare` | 8 | unchanged |
| `worker` | 8 | concurrent `grading-worker` invocations (× 2 lanes = 16 jobs) |
 Background pools wait with backoff instead
of bursting into 429s; `create-realtime-session` acquires one `realtime`
slot per interview for the whole session and answers `503 at_capacity` +
`retryAfterSeconds` when the pool is full. **`realtime.max_concurrent`
defaults to 12 (the measured OpenAI Build tier) and must be raised by hand
after the org tier is verified.**

### Verification status (2026-10-15)

Tested: 42 engine + SQL tests (`cd tests && npm test`, pglite applies the
real migrations), mock benchmark and in-process load model.

Verified in production (numbers in `load/README.md`):
- Real models, 4 interviews (good / wrong with the right terms / mixed with
  a skip / Arabic): 94 / 31 / 49 / 88, evidence verified in Hebrew and
  Arabic, completion to report 16 s p50; ≈ $0.04-0.06 per interview.
- Completion bursts of 20 to 250 interviews within 30 s through the real
  functions (server-side mock model, 4.5 s per call): every report written
  exactly once, zero retries, zero dead jobs; 200 → p50 86 s, p95 153 s.
- Scenario A and the realtime admission burst: see `load/README.md`.

Not verified: the realtime pool (12) against the org's current Realtime
limit; 200 live voice sessions (WebRTC + OpenAI Realtime were not driven);
real-model grading under a 200 burst (pools are sized from measured limits,
not from a measured burst); grading accuracy against lecturer ratings (no
human-labelled set yet; a verbatim-read Arabic answer scored 93 on knowledge,
which the integrity overlap flag reports separately).
