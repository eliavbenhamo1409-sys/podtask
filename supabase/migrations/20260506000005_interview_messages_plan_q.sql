-- Track which planned interview question each message belongs to so the
-- rubric model can grade per-question rather than from a flat transcript.
-- The plan question id is a free-form string (the id of an entry inside
-- public.interview_plans.plan.questions) and is null for greetings,
-- spontaneous follow-ups, or messages that pre-date this column.

alter table public.interview_messages
  add column if not exists plan_question_id text null;

create index if not exists interview_messages_plan_question_id_idx
  on public.interview_messages (interview_id, plan_question_id);
