-- Podtask: size the grading capacity pools from MEASURED OpenAI limits.
--
-- Measured 2026-10-15 from the x-ratelimit-* headers the grading worker
-- records in grading_runs.usage (real gpt-4.1 / gpt-4.1-mini calls):
--   gpt-4.1       2,000,000 TPM, 10,000 RPM
--   gpt-4.1-mini 10,000,000 TPM, 10,000 RPM
-- One evaluation call is ~2.2k input + ~0.5k output tokens and takes ~4.6 s,
-- so one busy slot uses ~35k TPM: 2M TPM fits ~57 slots. The pools below keep
-- ~30 % headroom for the other gpt-4.1 users (prepare-submission) and bursts.
--
-- The realtime pool is NOT changed: the voice model's limit was last
-- measured at 200k TPM (~12 live interviews) and has not been re-verified.

update public.ai_capacity set max_concurrent = 40, updated_at = now(),
  description = 'Per-question evaluation calls (gpt-4.1, 2M TPM measured 2026-10-15; ~35k TPM per busy slot).'
where pool = 'evaluate';

update public.ai_capacity set max_concurrent = 16, updated_at = now(),
  description = 'Second-pass verification calls (gpt-4.1, shares the 2M TPM budget with evaluate).'
where pool = 'verify';

update public.ai_capacity set max_concurrent = 16, updated_at = now(),
  description = 'Report narrative calls (gpt-4.1-mini, 10M TPM measured 2026-10-15).'
where pool = 'narrative';
