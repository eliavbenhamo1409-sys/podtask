# Podtask — project brief

**What it is:** a Hebrew-first (he/en UI) web app where a student uploads an academic
submission (PDF/DOCX/TXT) and is then interviewed about it, live and by voice, by an
AI "podcast host" (אריה / Aria). The interview itself runs in a language the student
picks in the lobby (he / en / ar, `interviews.language`); the host speaks, listens and
is transcribed in that language only. The goal is to gauge how well the student
understands their own work. After the interview the system scores the answers and
produces a report for the lecturer. The **student studio** and a first
**lecturer dashboard** (`/[locale]/lecturer`: courses, assignments, roster,
interview reports with integrity signals) are built; admin has no UI.

**Live:** https://podtask.vercel.app  ·  GitHub: eliavbenhamo1409-sys/podtask  ·
Supabase project `podtask` (ref `jxlrpewoqikpswxmtdma`, region ap-northeast-1).

**Deeper map:** `ARCHITECTURE.md` (pipeline, the four status vocabularies, modes,
interview room, data layer, known issues). Edge functions: `supabase/functions/README.md`.

## Stack
- Next.js 16 (App Router, `app/[locale]/…`), React 19, TypeScript strict,
  Tailwind 3 (tokens mostly live in `styles/globals.css`), framer-motion,
  next-intl (`lib/i18n/messages/{he,en}.json`, locale prefix always).
  `@tanstack/react-query` is mounted as a provider only. No Radix/shadcn, no
  zustand, no form library — the UI is hand-written primitives in `components/podtask`.
- Supabase: Postgres (17 tables: profiles, institutions, courses, assignments,
  submissions, document_parses/chunks/analyses, interviews, interview_plans,
  interview_messages, answer_evaluations, reports, …), RLS, Storage, Auth
  (admin-created username+password accounts, student / lecturer login tabs,
  guest via `create-guest-session`; `ARCHITECTURE.md` §8 "Accounts and sign-in").
- Supabase Edge Functions (Deno) in `supabase/functions/`:
  `prepare-submission` (parse → analyze → question pool + seeded plan → interview row),
  `interview-control` (consent / start-resume / telemetry / host flags, service role),
  `create-realtime-session` (mints an OpenAI Realtime session, `gpt-realtime`,
  transcription `gpt-4o-transcribe`, system prompt from
  `_shared/realtime-instructions.ts`), `save-interview-message`,
  `complete-interview` (idempotent + server-side integrity analysis),
  `grading-worker` (the grading engine v2: `_shared/grading/*`, durable
  `grading_jobs` queue, versioned `grading_runs`, capacity gate; see
  `ARCHITECTURE.md` §9), `generate-report` / `evaluate-answer` (thin
  re-queue wrappers), `create-guest-session` (service-role, unauthenticated
  by design, rate limited). `_shared/providers.ts` is dormant mock code.
- OpenAI via `_shared/openai.ts`: gpt-4.1-mini for parse/analyze/plan, gpt-4.1
  for scoring. Two secrets: `openai_realtime` (create-realtime-session) and
  `openai_realtime2` (everything else).
- Flags live in `lib/env.ts`: `MOCK_MODE` (**mock is the default**; only
  `NEXT_PUBLIC_MOCK_MODE=false` enables Supabase) and `REALTIME_ADAPTER`
  (`NEXT_PUBLIC_REALTIME_ADAPTER=openai` for real voice). Non-UUID demo ids
  always stay on mock (`isUuidLike` in `lib/utils.ts`).

## Student flow (routes under `/[locale]/student`)
dashboard → assignment details → upload → `submissions/:id/processing`
(invokes `prepare-submission`, subscribes/polls) → lobby → consent (integrity
notice, recorded server-side) → mic-test (mic + camera check) →
`interviews/:id` (page calls `interview-control` start; WebRTC to OpenAI
Realtime, 5 planned questions chosen server-side from a pool of 12, host
announces the ordinal, calls `finish_interview` only after saying goodbye;
camera self-view, activity telemetry, gentle silence nudges, own-words prompt,
`flag_answer`) → `interviews/:id/complete` (score card, rubric, transcript).
Integrity design and trust model: `ARCHITECTURE.md` §8. Also
`student/self/new` for self-initiated assignments (personal course per
institution), history, profile, help.

## Working rules
- Gates: `npm run check` (tsc + eslint) and `npm run build`. The grading
  engine and its migration have tests: `cd tests && npm install && npm test`
  (node --test + pglite). `bench/` (grading accuracy / model comparison) and
  `load/` (queue + concurrency) run on mocks by default. Do not land
  behaviour changes in the interview room without a live run.
- Keep `lib/realtime/host-text-heuristics.ts` and `lib/realtime/host-directives.ts`
  in sync with the prompt in `supabase/functions/_shared/realtime-instructions.ts`
  (ordinals, farewells, system-note kinds) for all three interview languages.
- Student transcripts go through `lib/realtime/student-text-guard.ts` before they
  count as answers; rejected turns are `discarded_utterance:<kind>` system lines.
- Hebrew copy uses feminine second person by default.
- `podtask 2/` is the original static HTML design prototype, not app code.
- Project skills for agents are in `.agents/skills/` (Supabase, Postgres).

## Deploying (do this after every completed change)
- **Web app → Vercel:** Vercel is git-connected; a push to `main` is the deploy.
  Commit explicitly, then run `scripts/deploy.sh` — it refuses a dirty tree,
  runs `npm run check`, pushes, polls the Vercel status on GitHub and prints
  the live URL. `scripts/deploy.sh --wait-only` just waits on the current HEAD.
  The local Vercel CLI token is expired; do not rely on `vercel deploy`.
- **Edge functions → Supabase:** Supabase MCP `deploy_edge_function` with
  project_id `jxlrpewoqikpswxmtdma`, including the `_shared/*` files the
  function imports. **Read `supabase/functions/README.md` first: the deployed
  `create-realtime-session` and `generate-report` differ from the repo.**
- **Migrations:** Supabase MCP `apply_migration`; the remote already has all
  files in `supabase/migrations/` applied (names match, versions differ).
