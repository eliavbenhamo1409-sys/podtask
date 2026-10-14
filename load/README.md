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

## What each target proves

| target | proves | does not prove |
| --- | --- | --- |
| `mock` | the orchestration maths: queue + lease + backoff semantics, capacity pools, how many workers / what pool sizes drain N interviews in how long, that admission refuses cleanly above the realtime pool | anything about Supabase, Vercel, WebRTC or OpenAI |
| `supabase` scenario B | the real durable queue end to end (trigger → claim → worker → persist → `report_ready`), latency from completion to report under a burst, retries / dead letters, with no model spend | model latency and 429 behaviour (the server runs the mock provider) |
| `supabase` scenario A | auth + `interview-control` + `save-interview-message` + `complete-interview` under N concurrent clients, admission control when `--mint` is on | that 200 real voice sessions work: WebRTC audio and the OpenAI Realtime tier are not exercised |

HTTP-only runs never demonstrate 200 live voice interviews. The realtime
ceiling is the OpenAI org tier (`ai_capacity.realtime.max_concurrent` must
be set from the verified tier); see `ARCHITECTURE.md` §9.

## Knobs

`--burst-sec` arrival window, `--duration-min` / `--turn-sec` session shape,
`--pools realtime=12,evaluate=10,verify=4,narrative=6` capacity, `--workers`
concurrent worker invocations, `--batch` jobs per invocation, `--tick-ms`
cron tick, `--mock-eval-ms` simulated model latency per call.
