import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_HEAD_AWAY, HeadAwayTracker, headPoseFromMatrix } from "../../lib/integrity/head-pose.ts";

/** Column-major 4x4 from a row-major 3x3 rotation. */
function matrix(r: number[][]): number[] {
  const m = new Array(16).fill(0);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[col * 4 + row] = r[row][col];
  m[15] = 1;
  return m;
}
const rad = (d: number) => (d * Math.PI) / 180;
function rotY(deg: number): number[][] {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
}
function rotX(deg: number): number[][] {
  const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
  return [[1, 0, 0], [0, c, -s], [0, s, c]];
}

test("identity matrix is a neutral pose", () => {
  const p = headPoseFromMatrix(matrix([[1, 0, 0], [0, 1, 0], [0, 0, 1]]));
  assert.ok(p);
  assert.ok(Math.abs(p.yawDeg) < 1e-6 && Math.abs(p.pitchDeg) < 1e-6 && Math.abs(p.rollDeg) < 1e-6);
});

test("yaw and pitch are recovered from pure rotations (magnitude)", () => {
  const y = headPoseFromMatrix(matrix(rotY(30)));
  assert.ok(y && Math.abs(Math.abs(y.yawDeg) - 30) < 1e-6, JSON.stringify(y));
  assert.ok(y && Math.abs(y.pitchDeg) < 1e-6);
  const x = headPoseFromMatrix(matrix(rotX(25)));
  assert.ok(x && Math.abs(Math.abs(x.pitchDeg) - 25) < 1e-6, JSON.stringify(x));
  assert.ok(x && Math.abs(x.yawDeg) < 1e-6);
});

test("malformed matrices yield null", () => {
  assert.equal(headPoseFromMatrix([]), null);
  assert.equal(headPoseFromMatrix(new Array(16).fill(NaN)), null);
});

test("a short natural turn never opens an interval", () => {
  const tr = new HeadAwayTracker({ ...DEFAULT_HEAD_AWAY, smoothing: 1 });
  let t = 0;
  for (let i = 0; i < 4; i++) assert.equal(tr.observe({ yawDeg: 50, pitchDeg: 0, rollDeg: 0 }, (t += 700)), null);
  for (let i = 0; i < 4; i++) assert.equal(tr.observe({ yawDeg: 0, pitchDeg: 0, rollDeg: 0 }, (t += 700)), null);
  assert.equal(tr.isOpen, false);
});

test("a sustained turn opens after the dwell and closes after the return time", () => {
  const tr = new HeadAwayTracker({ ...DEFAULT_HEAD_AWAY, smoothing: 1 });
  let t = 1000;
  let opened = null;
  for (let i = 0; i < 8 && !opened; i++) opened = tr.observe({ yawDeg: 40, pitchDeg: 0, rollDeg: 0 }, (t += 700));
  assert.ok(opened && opened.type === "open" && opened.axis === "yaw");
  assert.equal(opened.startedAt, 1700);
  // a glance back shorter than returnMs does not close
  assert.equal(tr.observe({ yawDeg: 5, pitchDeg: 0, rollDeg: 0 }, (t += 700)), null);
  assert.equal(tr.observe({ yawDeg: 40, pitchDeg: 0, rollDeg: 0 }, (t += 700)), null);
  assert.equal(tr.isOpen, true);
  let closed = null;
  for (let i = 0; i < 5 && !closed; i++) closed = tr.observe({ yawDeg: 3, pitchDeg: 0, rollDeg: 0 }, (t += 700));
  assert.ok(closed && closed.type === "close" && closed.peakDeg === 40);
  assert.equal(tr.isOpen, false);
});

test("hysteresis: between exit and enter thresholds the state is kept", () => {
  const tr = new HeadAwayTracker({ ...DEFAULT_HEAD_AWAY, smoothing: 1 });
  let t = 0;
  for (let i = 0; i < 8; i++) tr.observe({ yawDeg: 0, pitchDeg: 36, rollDeg: 0 }, (t += 700));
  assert.equal(tr.isOpen, true);
  for (let i = 0; i < 8; i++) assert.equal(tr.observe({ yawDeg: 0, pitchDeg: 28, rollDeg: 0 }, (t += 700)), null);
  assert.equal(tr.isOpen, true);
});

test("reset closes an open interval (face lost)", () => {
  const tr = new HeadAwayTracker({ ...DEFAULT_HEAD_AWAY, smoothing: 1 });
  let t = 0;
  for (let i = 0; i < 8; i++) tr.observe({ yawDeg: 45, pitchDeg: 0, rollDeg: 0 }, (t += 700));
  const r = tr.reset(t + 100);
  assert.ok(r && r.type === "close");
  assert.equal(tr.isOpen, false);
});
