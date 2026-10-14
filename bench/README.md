# Grading benchmark

Measures the grading engine (`supabase/functions/_shared/grading/*`) the way
production runs it: every case goes through `gradeInterview` with an
in-memory store, so prompt, evidence verification, selective second pass and
the deterministic scorer are exercised end to end.

```bash
# harness check, zero cost, deterministic (mock model)
node bench/grading/run.ts --provider mock --repeats 3

# real models (needs the key; refuses above --budget-usd unless --yes)
OPENAI_API_KEY=sk-... node bench/grading/run.ts --provider openai --models gpt-4.1,gpt-4.1-mini --repeats 3 --budget-usd 3

# the org's actual rate limits for a model (one tiny call, prints x-ratelimit-* headers)
OPENAI_API_KEY=sk-... node bench/grading/run.ts --probe --models gpt-4.1

# lecturer-rated dataset (production transcripts + human scores)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... OPENAI_API_KEY=... \
  node bench/grading/run.ts --provider openai --models gpt-4.1 --human bench/grading/dataset/human/ratings.jsonl
```

Results are written to `bench/results/<date>-<provider>.{json,md}`. Re-run
and commit a result for every change of `RUBRIC_VERSION`, `PROMPT_VERSION`,
`SCORING_VERSION` or the default models.

## What is measured

| metric | meaning |
| --- | --- |
| in-band | share of banded cases whose question score fell inside the expected band |
| band MAE | mean distance to the nearest band edge (0 when inside) |
| status match | the `answer_status` the policy expects (correct / partial / vague / incorrect / missing / unassessable / skipped / no_answer) |
| low-criteria ok | cases that must keep a named criterion ≤ 2 (the terminology trap keeps `accuracy` low, the contradiction keeps `consistency` low, …) |
| invalid evidence | quotes the model cited that do not exist in the student's turns (verified by `evidence.ts`) |
| no evidence | answered questions with no quote at all |
| human review | runs the engine would hand to a lecturer |
| 2nd pass | runs that triggered the independent second evaluation |
| repeat sd / ICC / flip@50 | stability across `--repeats` runs: mean per-case standard deviation, ICC(2,1), share of run pairs that flipped a pass/fail decision at 50 |
| p50 / p95 | wall time per case (the whole single-question pipeline) |
| $/eval, $/interview | estimated from token usage and `cost.ts`; interview = 5 evaluations + narrative |

## Synthetic cases (`grading/dataset.ts`)

Fifteen single-question cases in Hebrew and English: perfect, average, wrong
with the right terminology, long but empty, short and precise, one major
error, partial, a follow-up that corrects an earlier slip, an internal
contradiction, a skipped question, transcription garble, no answer after a
disconnect, a good application answer, reflection platitudes, an off-topic
answer. The bands encode the grading policy; they are not ground truth and
must not be presented as academic validation.

## Human-rated dataset (`grading/dataset/human/`)

JSONL, one line per rating:

```json
{"interviewId":"<uuid>","questionId":"q2","raterId":"lecturer-1","score":72,"criteria":{"accuracy":4,"explanation":3},"notes":"…"}
```

`--human` loads each interview's transcript from the project, grades it with
the real engine and reports MAE, ICC(2,1) and pass/fail agreement against the
mean lecturer score per question. Only use data whose use was permitted.
There are no ratings yet; until there are, every accuracy claim is limited to
the synthetic policy bands.
