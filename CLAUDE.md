# Podtask — project brief

**What it is:** a Hebrew-first (he/en) web app where a student uploads an academic
submission (PDF/DOCX/TXT) and is then interviewed about it, live and by voice, by an
AI "podcast host" (אריה / Aria). The goal is to gauge how well the student
understands their own work. After the interview the system scores the answers and
produces a report for the lecturer. Only the **student studio** is built so far;
the lecturer/admin side exists in the schema but has no UI.

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
  (email+password, magic link, guest via `create-guest-session`).
- Supabase Edge Functions (Deno) in `supabase/functions/`:
  `prepare-submission` (parse → analyze → plan → interview row),
  `create-realtime-session` (mints an OpenAI Realtime session, `gpt-realtime`,
  transcription `gpt-4o-transcribe`, system prompt from
  `_shared/realtime-instructions.ts`), `save-interview-message`,
  `complete-interview`, `generate-report`, `create-guest-session`
  (service-role, unauthenticated by design). `evaluate-answer` and
  `_shared/providers.ts` are dormant mock code.
- OpenAI via `_shared/openai.ts`: gpt-4.1-mini for parse/analyze/plan, gpt-4.1
  for scoring. Two secrets: `openai_realtime` (create-realtime-session) and
  `openai_realtime2` (everything else).
- Flags live in `lib/env.ts`: `MOCK_MODE` (**mock is the default**; only
  `NEXT_PUBLIC_MOCK_MODE=false` enables Supabase) and `REALTIME_ADAPTER`
  (`NEXT_PUBLIC_REALTIME_ADAPTER=openai` for real voice). Non-UUID demo ids
  always stay on mock (`isUuidLike` in `lib/utils.ts`).

## Student flow (routes under `/[locale]/student`)
dashboard → assignment details → upload → `submissions/:id/processing`
(invokes `prepare-submission`, subscribes/polls) → lobby → mic-test →
`interviews/:id` (WebRTC to OpenAI Realtime, 5 planned questions, host announces
the ordinal, calls `finish_interview` only after saying goodbye) →
`interviews/:id/complete` (score card, rubric, transcript). Also
`student/self/new` for self-initiated assignments (personal course per
institution), history, profile, help.

## Working rules
- Gates: `npm run check` (tsc + eslint) and `npm run build`. There are no tests;
  do not land behaviour changes in the interview room without a live run.
- Keep `lib/realtime/host-text-heuristics.ts` in sync with the prompt in
  `supabase/functions/_shared/realtime-instructions.ts` (ordinals, farewells).
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
