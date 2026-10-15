# Load tests

```bash
# Scenario B: 200 interviews finish within 30 s; the queue drains them (in-process, zero cost)
node load/run.ts --scenario b --users 200 --target mock --mock-eval-ms 900 --workers 8 --batch 2

# Scenario A: 200 students connect within 30 s and talk for 12 min (1 simulated minute = 1 s)
node load/run.ts --scenario a --users 200 --target mock --time-scale 60

# Staged runs
for n in 20 50 100 150 200 250; do node load/run.ts --scenario b --users $n --target mock; done

# Real project (service role; writes and then deletes its own rows; needs the grading
# migration, grading-worker and cron deployed; jobs run with the server-side mock provider)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node load/run.ts --scenario b --users 50 --target supabase --yes
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_ANON_KEY=... \
  node load/run.ts --scenario a --users 50 --target supabase --yes            # add --mint to also mint OpenAI secrets
```

Results land in `load/results/*.json`.

## Production end-to-end runs (`load/e2e.ts`, 2026-10-15)

`load/e2e.ts` drives the REAL functions with a test user's session, exactly as
N browsers would: no service-role key, credentials from `LOADTEST_EMAIL` /
`LOADTEST_PASSWORD`, URL and anon key from `.env.local`. Test interviews are
created by the temporary SQL helpers in `load/loadtest-helpers.sql` (run
before, drop after) and graded by the server-side mock model (4.5 s per
call), so the whole path runs except the OpenAI call itself.

```bash
LOADTEST_EMAIL=... LOADTEST_PASSWORD=... node load/e2e.ts complete --from-status in_progress --burst-sec 30 --label b-200
LOADTEST_EMAIL=... LOADTEST_PASSWORD=... node load/e2e.ts session  --from-status ready --burst-sec 30 --duration-min 12 --turn-sec 20 --label a-200
LOADTEST_EMAIL=... LOADTEST_PASSWORD=... node load/e2e.ts mint     --from-status in_progress --burst-sec 10 --label mint-30
```

Scenario B: N interviews call `complete-interview` within 30 s, each client
then polls its report like the score card (`grading-worker` v3, 8 workers ×
2 lanes). Seconds from completion to a ready report, measured by the client;
queue wait and drain measured in `grading_jobs`.

| N | report p50 | report p95 | max | drain | queue wait p50 | run p50 | `complete-interview` p95 | errors | retries / dead |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 20 | 14 | 17 | 20 | n/a | n/a | n/a | 4.6 | 0 / 205 calls | 0 / 0 |
| 50 | 36 | 47 | 47 | n/a | n/a | n/a | 5.5 | 0 / 1,082 | 0 / 0 |
| 100 (v2, no lanes) | 62 | 101 | 108 | 137 | 49 | 12.6 | 3.9 | 0 / 3,884 | 0 / 0 |
| 100 | 41 | 65 | 69 | 101 | 30 | 12.6 | 4.5 | 0 / 2,754 | 0 / 0 |
| 150 | 66 | 119 | 120 | 150 | 53 | 13.2 | 4.1 | 0 / 6,433 | 0 / 0 |
| 200 | 86 | 153 | 156 | 188 | 75 | 13.1 | 5.1 | 0 / 11,216 | 0 / 0 |
| 200 (3 lanes) | 73 | 128 | 140 | 171 | 61 | 14.7 | 6.9 | 0 / 9,191 | 0 / 0 |
| 250 | 88 | 160 | 170 | 201 | 80 | 9.9 | 5.4 | 0 / 14,048 | 0 / 0 |

Every stage: every report written exactly once (one `grading_runs` row and
five `answer_evaluations` per interview), no attempt retried, no dead job,
no 4xx / 5xx in the API or function logs. Throughput is bounded by the 16
concurrent jobs (≈ 1.1-1.3 interviews per second with a 4.5 s model);
3 lanes per worker drained 200 only ~10 % faster while slowing each job and
`complete-interview`, so `worker_batch` stays 2. With the real model the
`evaluate` pool (40 slots, sized from the measured 2M TPM) is the next limit.

Scenario A (`session`, 200 interviews, 12 min, 30 s arrival window): each
client starts its interview through `interview-control`, writes a host or
student turn through `save-interview-message` every ~20 s (36 per
interview), then completes and polls its report. No voice: WebRTC and the
OpenAI Realtime model are not involved.

| step | calls | errors | p50 | p95 | max |
| --- | --- | --- | --- | --- | --- |
| `interview-control` start | 200 | 0 | 2.3 s | 3.1 s | 4.8 s |
| `save-interview-message` | 7,200 | 0 | 1.4 s | 2.1 s | 7.9 s |
| `complete-interview` | 200 | 0 | 5.2 s | 6.7 s | 7.9 s |
| completion to ready report | 200 | 0 | 60 s | 108 s | 114 s |

All 7,200 turns were stored exactly once (7,200 distinct client ids), all
200 reports were written once with no retry, and the completions (spread
over 86 s) drained in 195 s.

Realtime admission (`mint`, 30 in-progress interviews within 10 s, pool
`realtime` = 12, no live session at the time): 12 admitted (a real client
secret minted, no audio sent), 18 refused with `503 at_capacity`,
`retryAfterSeconds` 60, one `realtime.admission_refused` event each.
Latency p50 2.2 s, p95 3.3 s. The 12 slots were released right after.

Real models (gpt-4.1 evaluate / verify, gpt-4.1-mini narrative), 4
interviews: completion to report 16 s p50, 21 s max; ≈ $0.043 per
interview without a second pass, ≈ $0.061 with one. 200 interviews ≈ $9-12
of grading. The 12-minute voice session itself (gpt-realtime audio +
gpt-4o-transcribe) is the dominant cost and was not measured here.

## What each target proves

| target | proves | does not prove |
| --- | --- | --- |
| `mock` | the orchestration maths: queue + lease + backoff semantics, capacity pools, how many workers / what pool sizes drain N interviews in how long, that admission refuses cleanly above the realtime pool | anything about Supabase, Vercel, WebRTC or OpenAI |
| `supabase` scenario B | the real durable queue end to end (trigger → claim → worker → persist → `report_ready`), latency from completion to report under a burst, retries / dead letters, with no model spend | model latency and 429 behaviour (the server runs the mock provider) |
| `supabase` scenario A | auth + `interview-control` + `save-interview-message` + `complete-interview` under N concurrent clients, admission control when `--mint` is on | that 200 real voice sessions work: WebRTC audio and the OpenAI Realtime tier are not exercised |
| `e2e.ts complete` / `session` | the same paths through a real user session (RLS, JWT verification, PostgREST, the report page's polling) with no service-role key | model latency, 429 behaviour, voice |
| `e2e.ts mint` | `create-realtime-session` admission against the production `realtime` pool: admitted vs `503 at_capacity` | that an admitted session can carry audio |

HTTP-only runs never demonstrate 200 live voice interviews. The realtime
ceiling is the OpenAI org tier (`ai_capacity.realtime.max_concurrent` must
be set from the verified tier); see `ARCHITECTURE.md` §9.

## Knobs

`--burst-sec` arrival window, `--duration-min` / `--turn-sec` session shape,
`--pools realtime=12,evaluate=10,verify=4,narrative=6` capacity, `--workers`
concurrent worker invocations, `--batch` jobs per invocation, `--tick-ms`
cron tick, `--mock-eval-ms` simulated model latency per call.
