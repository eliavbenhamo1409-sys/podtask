import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { PGlite } from "@electric-sql/pglite";
import { createDb, rpc } from "./helpers.ts";

let db: PGlite;
before(async () => {
  db = await createDb();
});
after(async () => {
  await db.close();
});

type Slot = { ok: boolean; in_flight?: number; max?: number; retry_after_seconds?: number; renewed?: boolean; unlimited?: boolean };

test("acquire_ai_slot enforces max_concurrent per pool, renews for the same holder, releases, and expires", async () => {
  await db.query("update public.ai_capacity set max_concurrent = 2 where pool = 'verify'");
  const a = await rpc<Slot>(db, "public.acquire_ai_slot", { p_pool: "verify", p_holder: "h1", p_ttl_seconds: 60 });
  const b = await rpc<Slot>(db, "public.acquire_ai_slot", { p_pool: "verify", p_holder: "h2", p_ttl_seconds: 60 });
  const c = await rpc<Slot>(db, "public.acquire_ai_slot", { p_pool: "verify", p_holder: "h3", p_ttl_seconds: 60 });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.equal(b.in_flight, 2);
  assert.equal(c.ok, false);
  assert.equal(c.max, 2);
  assert.ok((c.retry_after_seconds ?? 0) >= 1 && (c.retry_after_seconds ?? 0) <= 60);

  // Same holder again = renew, not a second slot.
  const a2 = await rpc<Slot>(db, "public.acquire_ai_slot", { p_pool: "verify", p_holder: "h1", p_ttl_seconds: 60 });
  assert.equal(a2.ok, true);
  assert.equal(a2.renewed, true);
  assert.equal((await db.query("select 1 from public.ai_slot_leases where pool = 'verify'")).rows.length, 2);

  assert.equal(await rpc(db, "public.release_ai_slot", { p_pool: "verify", p_holder: "h1" }), true);
  const c2 = await rpc<Slot>(db, "public.acquire_ai_slot", { p_pool: "verify", p_holder: "h3", p_ttl_seconds: 60 });
  assert.equal(c2.ok, true);

  // Expired leases free the slot even if the holder never released it.
  await db.query("update public.ai_slot_leases set expires_at = now() - interval '1 second' where holder = 'h2'");
  const d = await rpc<Slot>(db, "public.acquire_ai_slot", { p_pool: "verify", p_holder: "h4", p_ttl_seconds: 60 });
  assert.equal(d.ok, true);
  assert.equal(await rpc(db, "public.expire_ai_slots", {}), 0);

  // Unknown pool = unlimited (fail open by design, so a config gap never blocks grading).
  const u = await rpc<Slot>(db, "public.acquire_ai_slot", { p_pool: "nope", p_holder: "x", p_ttl_seconds: 60 });
  assert.equal(u.ok, true);
  assert.equal(u.unlimited, true);
});

test("a pool with max_concurrent = 0 refuses everyone (hard pause switch)", async () => {
  await db.query("update public.ai_capacity set max_concurrent = 0 where pool = 'narrative'");
  const r = await rpc<Slot>(db, "public.acquire_ai_slot", { p_pool: "narrative", p_holder: "n1", p_ttl_seconds: 60 });
  assert.equal(r.ok, false);
  assert.equal(r.in_flight, 0);
});
