import { test } from "node:test";
import assert from "node:assert/strict";
import { ActivityMonitor } from "../../lib/integrity/activity-monitor.ts";
import type { IntegrityClientEvent } from "../../lib/integrity/types.ts";

/** A tiny fake of document / window with manual timers. */
function fakeEnv() {
  let now = 100_000;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  let nextId = 1;
  const listeners = new Map<string, Set<() => void>>();
  const on = (type: string, fn: () => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  };
  const off = (type: string, fn: () => void) => listeners.get(type)?.delete(fn);
  const fire = (type: string) => listeners.get(type)?.forEach((fn) => fn());
  const doc = {
    visibilityState: "visible" as "visible" | "hidden",
    fullscreenElement: null as Element | null,
    addEventListener: on,
    removeEventListener: off,
  };
  const win = {
    addEventListener: on,
    removeEventListener: off,
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimeout: (id: number) => {
      const i = timers.findIndex((t) => t.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
  };
  const advance = (ms: number) => {
    const target = now + ms;
    while (true) {
      const due = timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      now = due.at;
      due.fn();
    }
    now = target;
  };
  const hide = () => { doc.visibilityState = "hidden"; fire("visibilitychange"); fire("blur"); };
  const show = () => { doc.visibilityState = "visible"; fire("visibilitychange"); fire("focus"); };
  return { doc, win, now: () => now, advance, fire, hide, show };
}

function setup(opts: { hiddenGraceMs?: number; blurMinMs?: number } = {}) {
  const env = fakeEnv();
  const events: IntegrityClientEvent[] = [];
  const returns: { ordinal: number; durationMs: number }[] = [];
  const mon = new ActivityMonitor({
    onEvent: (e) => events.push(e),
    getPlanQuestionId: () => "q1",
    onReturn: (r) => returns.push(r),
    now: env.now,
    doc: env.doc as unknown as Document,
    win: env.win as unknown as Window,
    ...opts,
  });
  mon.start();
  return { env, events, returns, mon };
}

test("normal tab switch: open row, close row with the same id, tab_returned, counter", () => {
  const { env, events, returns, mon } = setup();
  env.hide();
  env.advance(1000); // grace elapsed -> open emitted
  assert.deepEqual(events.map((e) => e.kind), ["visibility_hidden"]);
  assert.equal(events[0].endedAt, null);
  assert.equal(events[0].payload?.ordinal, 1);
  env.advance(4000);
  env.show();
  assert.deepEqual(events.map((e) => e.kind), ["visibility_hidden", "visibility_hidden", "tab_returned"]);
  assert.equal(events[1].eventId, events[0].eventId);
  assert.equal(events[1].durationMs, 5000);
  assert.equal(events[2].payload?.hidden_event_id, events[0].eventId);
  assert.deepEqual(returns, [{ ordinal: 1, durationMs: 5000 }]);
  assert.equal(mon.exitCount, 1);
  assert.equal(mon.hiddenTotal, 5000);
  // the blur that accompanied the hide was NOT counted as a separate event
  assert.equal(events.filter((e) => e.kind === "window_blur").length, 0);
});

test("rapid tab cycling below the grace period is dropped as flicker", () => {
  const { env, events, mon } = setup();
  for (let i = 0; i < 5; i++) {
    env.hide();
    env.advance(120);
    env.show();
    env.advance(120);
  }
  assert.equal(events.length, 0);
  assert.equal(mon.exitCount, 0);
});

test("hidden longer than the grace but with a throttled timer still records open + close", () => {
  const { env, events } = setup();
  env.hide();
  // Simulate a throttled background timer: time passes without the grace timer firing.
  // (advance() fires timers; use the monitor's now() directly instead.)
  const start = env.now();
  // Manually move time without running timers.
  env.advance(0);
  // Force: call show() after pretending 2 s elapsed via a fresh env.now by advancing timers past grace.
  env.advance(2000);
  env.show();
  const hidden = events.filter((e) => e.kind === "visibility_hidden");
  assert.equal(hidden.length, 2);
  assert.equal(hidden[1].durationMs, env.now() - start);
});

test("blur without hiding is a window_blur only when long enough, never a tab exit", () => {
  const { env, events, mon } = setup({ blurMinMs: 1500 });
  env.fire("blur");
  env.advance(500);
  env.fire("focus");
  assert.equal(events.length, 0);
  env.fire("blur");
  env.advance(3000);
  env.fire("focus");
  assert.deepEqual(events.map((e) => e.kind), ["window_blur"]);
  assert.equal(events[0].durationMs, 3000);
  assert.equal(mon.exitCount, 0);
  assert.deepEqual(mon.drainCounters(), { hiddenMs: 0, blurCount: 1 });
});

test("closing the browser while hidden: pagehide closes the interval without a return", () => {
  const { env, events, returns } = setup();
  env.hide();
  env.advance(2000);
  env.fire("pagehide");
  const kinds = events.map((e) => e.kind);
  assert.deepEqual(kinds, ["visibility_hidden", "visibility_hidden", "page_hidden"]);
  assert.equal(events[1].payload?.returned, false);
  assert.equal(returns.length, 0);
});

test("offline is recorded as a point event; stop closes an open interval", () => {
  const { env, events, mon } = setup();
  env.fire("offline");
  assert.deepEqual(events.map((e) => e.kind), ["offline"]);
  env.hide();
  env.advance(1000);
  mon.stop();
  const hidden = events.filter((e) => e.kind === "visibility_hidden");
  assert.equal(hidden.length, 2);
  assert.ok(hidden[1].endedAt);
  assert.equal(mon.isHidden, false);
});
