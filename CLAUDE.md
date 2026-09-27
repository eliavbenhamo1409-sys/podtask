# Podtask — project brief

**What it is:** a Hebrew-first (he/en) web app where a student uploads an academic
submission (PDF/DOCX/TXT) and is then interviewed about it, live and by voice, by an
AI "podcast host" (default name: אריה). The goal is to gauge how well the student
understands their own work. After the interview the system scores the answers and
produces a report for the lecturer. Only the **student studio** is built so far;
the lecturer/admin side exists in the schema but has no UI.

**Live:** https://podtask.vercel.app  ·  GitHub: eliavbenhamo1409-sys/podtask  ·
Supabase project `podtask` (ref `jxlrpewoqikpswxmtdma`, region ap-northeast-1).

## Stack
- Next.js 16 (App Router, `app/[locale]/…`), React 19, TypeScript, Tailwind 3,
  Radix/shadcn-style components, framer-motion, zustand, react-query, next-intl
  (`lib/i18n/messages/{he,en}.json`, locale prefix always).
- Supabase: Postgres (17 tables: profiles, institutions, courses, assignments,
  submissions, document_parses/chunks/analyses, interviews, interview_plans,
  interview_messages, answer_evaluations, reports, …), RLS, Storage, Auth
  (email+password, magic link, guest via `create-guest-session`).
- Supabase Edge Functions (Deno) in `supabase/functions/`:
  `prepare-submission` (parse → analyze → plan → interview row),
  `create-realtime-session` (mints an OpenAI Realtime session, `gpt-realtime`,
  transcription `gpt-4o-transcribe`, system prompt from
  `_shared/realtime-instructions.ts`), `save-interview-message`,
  `evaluate-answer`, `complete-interview`, `generate-report`,
  `create-guest-session` (service-role, unauthenticated by design).
- OpenAI models via `_shared/openai.ts`: gpt-4.1-mini for parse/analyze/plan,
  gpt-4.1 for scoring. Secret name: `openai_realtime2`.
- `NEXT_PUBLIC_MOCK_MODE=true` drives all screens from `lib/student/mock-data.ts`;
  `NEXT_PUBLIC_REALTIME_ADAPTER=openai|mock` picks the voice adapter.

## Student flow (routes under `/[locale]/student`)
dashboard → assignment details → upload → `submissions/:id/processing`
(polls `prepare-submission`) → lobby → mic-test → `interviews/:id`
(WebRTC to OpenAI Realtime, 5 planned questions, host announces ordinal,
calls `finish_interview` tool only after saying goodbye) → `interviews/:id/complete`
(score card, rubric, transcript). Also `student/self/new` for self-initiated
assignments (personal course per institution), history, profile, help.

## Deploying (do this after every completed change)
- **Web app → Vercel:** Vercel is git-connected; a push to `main` is the deploy.
  Run `scripts/deploy.sh "<commit message>"` — it typechecks, commits, pushes,
  polls the Vercel status on GitHub, and prints the live URL. Use
  `scripts/deploy.sh --wait-only` to just wait on the current HEAD.
  The local Vercel CLI token is expired; do not rely on `vercel deploy`.
- **Edge functions → Supabase:** use the Supabase MCP `deploy_edge_function`
  with project_id `jxlrpewoqikpswxmtdma` (include `_shared/*` files the
  function imports). See `MCP_DEPLOY_POLICY.md`.
- **Migrations:** apply via Supabase MCP `apply_migration`; the remote already has
  all files in `supabase/migrations/` applied (names match, versions differ).

## Notes
- `podtask 2/` is the original static HTML design prototype, not app code.
- Hebrew copy uses feminine second person by default.
