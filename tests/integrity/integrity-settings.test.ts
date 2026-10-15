import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isGuestIdentity,
  resolveIntegritySettings,
} from "../../supabase/functions/_shared/integrity-settings.ts";

test("the app copy of the settings module matches the edge copy (header line aside)", () => {
  const strip = (s: string) =>
    s.split("\n").filter((l) => !/^ \* (the primary copy lives|mirrored in)/.test(l)).join("\n");
  const edge = readFileSync(new URL("../../supabase/functions/_shared/integrity-settings.ts", import.meta.url), "utf8");
  const app = readFileSync(new URL("../../lib/integrity/settings.ts", import.meta.url), "utf8");
  assert.equal(strip(app), strip(edge));
});

test("lecturer assignments default to a required camera and activity telemetry", () => {
  const s = resolveIntegritySettings(null, { personal: false });
  assert.equal(s.camera, "required");
  assert.equal(s.activityMonitoring, true);
});

test("personal assignments default to no camera and no activity telemetry", () => {
  const s = resolveIntegritySettings(null, { personal: true });
  assert.equal(s.camera, "off");
  assert.equal(s.activityMonitoring, false);
  assert.equal(s.overlapCheck, true);
  assert.equal(s.hostFlags, true);
});

test("a guest on a personal assignment gets the lecturer defaults", () => {
  const s = resolveIntegritySettings(null, { personal: true, guest: true });
  assert.equal(s.camera, "required");
  assert.equal(s.activityMonitoring, true);
  assert.equal(s.requireConsent, true);
});

test("explicit assignment settings still win for a guest", () => {
  const s = resolveIntegritySettings(
    { integrity: { camera: "on", activity_monitoring: false } },
    { personal: true, guest: true },
  );
  assert.equal(s.camera, "on");
  assert.equal(s.activityMonitoring, false);
});

test("isGuestIdentity recognises the guest metadata flag, the guest e-mail domains and anon profiles", () => {
  assert.equal(isGuestIdentity({ email: "x@example.edu", metadata: { is_guest: true } }), true);
  assert.equal(isGuestIdentity({ email: "guest-123@guest.podtask.app" }), true);
  assert.equal(isGuestIdentity({ email: "GUEST-123@GUEST.PODTASK.LOCAL" }), true);
  assert.equal(isGuestIdentity({ email: "anon-abc@guest.podtask.local" }), true);
  assert.equal(isGuestIdentity({ email: "maya@example.edu" }), false);
  assert.equal(isGuestIdentity({ email: "maya@example.edu", metadata: { is_guest: false } }), false);
  assert.equal(isGuestIdentity({ email: null, metadata: null }), false);
  assert.equal(isGuestIdentity(null), false);
});
