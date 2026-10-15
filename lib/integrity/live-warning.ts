/**
 * Live warnings on the student's camera self-view: a small sign that shows
 * only when the camera gives reasonable grounds for suspicion, never for a
 * single glance.
 *
 *   look_away       head or eyes off the screen for `sustainedMs` in a row
 *   glances         off the screen for `windowAwayMs` of the last `windowMs`,
 *                   over at least `windowEpisodes` separate looks (the
 *                   "reading notes beside the screen" pattern)
 *   another_person  a multiple_faces interval is open (PresenceTracker)
 *   face_missing    a face_missing interval is open (PresenceTracker)
 *
 * "Off the screen" is measured against the student's own baseline (a running
 * median), so a camera mounted to the side or above a second monitor does not
 * count as looking away. Looking up is ignored for the eyes: that is how
 * people think, not how they read. Eye direction comes from MediaPipe face
 * blendshapes and is only read while the head is close to its baseline: with
 * the head turned, the eyes often counter-rotate to stay on the screen and
 * the two signals cannot be told apart.
 *
 * Pure module, no DOM: unit-tested in `tests/integrity/live-warning.test.ts`.
 */
import type { HeadPose } from "./head-pose";

/** Eye direction relative to the head, from face blendshapes. */
export interface EyeGaze {
  /**
   * Horizontal, -1..1. Which sign is which side depends on the model's
   * left/right naming, so only the magnitude is used.
   */
  h: number;
  /** eyeLookDown minus eyeLookUp, -1..1 (positive = down). */
  v: number;
  /** Mean eyeBlink, 0..1 (eye readings are unreliable when high). */
  blink: number;
}

interface BlendshapeCategory {
  categoryName: string;
  score: number;
}

export function eyeGazeFromBlendshapes(categories: ReadonlyArray<BlendshapeCategory> | null | undefined): EyeGaze | null {
  if (!categories || categories.length === 0) return null;
  const s = new Map<string, number>();
  for (const c of categories) {
    if (c && typeof c.categoryName === "string" && Number.isFinite(c.score)) s.set(c.categoryName, c.score);
  }
  const need = [
    "eyeLookInLeft",
    "eyeLookInRight",
    "eyeLookOutLeft",
    "eyeLookOutRight",
    "eyeLookDownLeft",
    "eyeLookDownRight",
    "eyeLookUpLeft",
    "eyeLookUpRight",
  ];
  if (!need.every((k) => s.has(k))) return null;
  const g = (k: string) => s.get(k) ?? 0;
  // Both eyes turned to the same side: one looks "out", the other "in".
  const h = (g("eyeLookOutLeft") + g("eyeLookInRight") - g("eyeLookInLeft") - g("eyeLookOutRight")) / 2;
  const v = (g("eyeLookDownLeft") + g("eyeLookDownRight") - g("eyeLookUpLeft") - g("eyeLookUpRight")) / 2;
  const blink = (g("eyeBlinkLeft") + g("eyeBlinkRight")) / 2;
  return { h, v, blink };
}

export type LiveWarningReason = "look_away" | "glances" | "another_person" | "face_missing";
export type LookCue = "head" | "eyes";

export interface LiveWarning {
  reason: LiveWarningReason;
  /** What was off the screen (look_away / glances). */
  cue: LookCue | null;
  /** When the sign appeared (ms). */
  since: number;
}

export interface LiveWarningSample {
  at: number;
  faces: number;
  pose: HeadPose | null;
  eyes: EyeGaze | null;
  /** Open PresenceTracker intervals. */
  faceMissing: boolean;
  multipleFaces: boolean;
}

export interface LiveWarningThresholds {
  /** Head deviation from the baseline that counts as off the screen (enter / exit). */
  headYawEnterDeg: number;
  headYawExitDeg: number;
  headPitchEnterDeg: number;
  headPitchExitDeg: number;
  /** Above this head deviation the eyes are not read (they may be compensating). */
  eyeIgnoreYawDeg: number;
  eyeIgnorePitchDeg: number;
  /** |h| deviation from the baseline (enter / exit). */
  eyeSideEnter: number;
  eyeSideExit: number;
  /** Downward v deviation from the baseline (enter / exit). */
  eyeDownEnter: number;
  eyeDownExit: number;
  /** Mean eyeBlink above which an eye reading is skipped. */
  blinkMax: number;
  /** Exponential smoothing factor, 0..1 (1 = none). */
  smoothing: number;
  /** One continuous look away this long. */
  sustainedMs: number;
  /** The repeated-glances window. */
  windowMs: number;
  windowAwayMs: number;
  windowEpisodes: number;
  /** Shorter looks are noise and are not counted as glances. */
  minEpisodeMs: number;
  /** No look-away warnings until the baseline has this many samples. */
  baselineMinSamples: number;
  baselineSize: number;
  /** The baseline never drifts further than this from straight ahead. */
  baselineMaxYawDeg: number;
  baselineMaxPitchDeg: number;
  baselineMaxEyeSide: number;
  baselineMaxEyeDown: number;
  /** A sign stays at least this long... */
  minVisibleMs: number;
  /** ...and this long after the cause is gone. */
  holdMs: number;
  /** At most one stored event per reason in this span. */
  eventCooldownMs: number;
}

export const LIVE_WARNING_DEFAULTS: LiveWarningThresholds = {
  headYawEnterDeg: 28,
  headYawExitDeg: 20,
  headPitchEnterDeg: 22,
  headPitchExitDeg: 15,
  eyeIgnoreYawDeg: 15,
  eyeIgnorePitchDeg: 12,
  eyeSideEnter: 0.5,
  eyeSideExit: 0.32,
  eyeDownEnter: 0.45,
  eyeDownExit: 0.28,
  blinkMax: 0.55,
  smoothing: 0.5,
  sustainedMs: 6000,
  windowMs: 30_000,
  windowAwayMs: 12_000,
  windowEpisodes: 3,
  minEpisodeMs: 1000,
  baselineMinSamples: 15,
  baselineSize: 120,
  baselineMaxYawDeg: 20,
  baselineMaxPitchDeg: 20,
  baselineMaxEyeSide: 0.25,
  baselineMaxEyeDown: 0.35,
  minVisibleMs: 5000,
  holdMs: 3000,
  eventCooldownMs: 20_000,
};

export interface LiveWarningEvent {
  at: number;
  reason: LiveWarningReason;
  cue: LookCue | null;
  /** Off-screen time behind a look_away / glances warning. */
  awayMs: number | null;
  /** Looks counted for a glances warning. */
  episodes: number | null;
}

export interface LiveWarningDebug {
  faces: number;
  yaw: number | null;
  pitch: number | null;
  eyeSide: number | null;
  eyeDown: number | null;
  blink: number | null;
  /** Deviations from the baseline. */
  dYaw: number | null;
  dPitch: number | null;
  dEyeSide: number | null;
  dEyeDown: number | null;
  baselineSamples: number;
  off: LookCue | null;
  offMs: number;
  windowAwayMs: number;
  windowEpisodes: number;
}

export interface LiveWarningOutput {
  /** The sign changed (appeared, switched reason, or cleared). */
  changed: boolean;
  /** A new sign to store as an `integrity_warning` event. */
  event: LiveWarningEvent | null;
}

interface Episode {
  start: number;
  end: number;
}

const PRIORITY: Record<LiveWarningReason, number> = {
  another_person: 4,
  face_missing: 3,
  look_away: 2,
  glances: 1,
};

function clamp(n: number, lim: number): number {
  return Math.max(-lim, Math.min(lim, n));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

class Ring {
  private values: number[] = [];
  constructor(private readonly size: number) {}
  push(v: number): void {
    this.values.push(v);
    if (this.values.length > this.size) this.values.shift();
  }
  get length(): number {
    return this.values.length;
  }
  median(): number {
    return median(this.values);
  }
}

export class LiveWarningMonitor {
  private readonly th: LiveWarningThresholds;
  // Smoothed readings.
  private yaw: number | null = null;
  private pitch: number | null = null;
  private eyeSide: number | null = null;
  private eyeDown: number | null = null;
  private blink: number | null = null;
  // Baselines (running medians of the smoothed readings).
  private readonly baseYaw: Ring;
  private readonly basePitch: Ring;
  private readonly baseEyeSide: Ring;
  private readonly baseEyeDown: Ring;
  // Off-screen state.
  private headOff = false;
  private eyesOff = false;
  private offSince: number | null = null;
  private offCue: LookCue | null = null;
  private episodes: Episode[] = [];
  // The sign.
  private active: LiveWarning | null = null;
  private clearSince: number | null = null;
  private lastEventAt = new Map<LiveWarningReason, number>();
  private last: LiveWarningDebug | null = null;

  constructor(thresholds: Partial<LiveWarningThresholds> = {}) {
    this.th = { ...LIVE_WARNING_DEFAULTS, ...thresholds };
    this.baseYaw = new Ring(this.th.baselineSize);
    this.basePitch = new Ring(this.th.baselineSize);
    this.baseEyeSide = new Ring(this.th.baselineSize);
    this.baseEyeDown = new Ring(this.th.baselineSize);
  }

  get warning(): LiveWarning | null {
    return this.active;
  }

  get debug(): LiveWarningDebug | null {
    return this.last;
  }

  observe(sample: LiveWarningSample): LiveWarningOutput {
    const now = sample.at;
    this.trackLook(sample);
    this.episodes = this.episodes.filter((e) => e.end > now - this.th.windowMs);
    const window = this.windowStats(now);
    const offMs = this.offSince === null ? 0 : now - this.offSince;
    this.last = { ...this.readings(sample.faces), off: this.offSince === null ? null : this.offCue, offMs, ...window };

    let cause: { reason: LiveWarningReason; cue: LookCue | null } | null = null;
    if (sample.multipleFaces) cause = { reason: "another_person", cue: null };
    else if (sample.faceMissing) cause = { reason: "face_missing", cue: null };
    else if (this.offSince !== null && offMs >= this.th.sustainedMs) cause = { reason: "look_away", cue: this.offCue };
    else if (window.windowEpisodes >= this.th.windowEpisodes && window.windowAwayMs >= this.th.windowAwayMs) {
      cause = { reason: "glances", cue: this.offCue ?? "eyes" };
    }

    if (cause) {
      this.clearSince = null;
      const a = this.active;
      if (a && a.reason === cause.reason) {
        if (cause.cue && a.cue !== cause.cue && cause.reason === "look_away") a.cue = cause.cue;
        return { changed: false, event: null };
      }
      if (a && PRIORITY[a.reason] > PRIORITY[cause.reason]) return { changed: false, event: null };
      this.active = { reason: cause.reason, cue: cause.cue, since: now };
      const event = this.maybeEvent(now, cause.reason, cause.cue, cause.reason === "glances" ? window : { offMs });
      // A glances sign starts the pattern over: it needs fresh evidence to return.
      if (cause.reason === "glances") this.episodes = [];
      return { changed: true, event };
    }

    if (!this.active) return { changed: false, event: null };
    if (this.clearSince === null) this.clearSince = now;
    if (now - this.active.since >= this.th.minVisibleMs && now - this.clearSince >= this.th.holdMs) {
      this.active = null;
      this.clearSince = null;
      return { changed: true, event: null };
    }
    return { changed: false, event: null };
  }

  /**
   * Nothing is known any more (tab hidden, camera off, tracking lost): drop
   * the sign and any look in progress. The baseline is kept.
   */
  reset(): boolean {
    this.headOff = false;
    this.eyesOff = false;
    this.offSince = null;
    this.offCue = null;
    this.episodes = [];
    this.yaw = this.pitch = this.eyeSide = this.eyeDown = this.blink = null;
    this.clearSince = null;
    const had = this.active !== null;
    this.active = null;
    return had;
  }

  // ---- internals ----

  private trackLook(sample: LiveWarningSample): void {
    const now = sample.at;
    if (sample.faces !== 1 || !sample.pose) {
      // No single tracked face: whatever look was running ends here.
      this.endLook(now);
      this.headOff = false;
      this.eyesOff = false;
      this.yaw = this.pitch = this.eyeSide = this.eyeDown = this.blink = null;
      return;
    }
    const a = this.th.smoothing;
    const ease = (prev: number | null, next: number) => (prev === null ? next : prev + a * (next - prev));
    this.yaw = ease(this.yaw, sample.pose.yawDeg);
    this.pitch = ease(this.pitch, sample.pose.pitchDeg);
    const eyesReadable = sample.eyes !== null && sample.eyes.blink < this.th.blinkMax;
    if (sample.eyes) this.blink = sample.eyes.blink;
    if (eyesReadable && sample.eyes) {
      this.eyeSide = ease(this.eyeSide, sample.eyes.h);
      this.eyeDown = ease(this.eyeDown, sample.eyes.v);
    }

    const eyesKnown = eyesReadable && this.eyeSide !== null && this.eyeDown !== null;

    // Warm-up: the first samples set the baseline whatever they are (the
    // clamp keeps a bad start from going far), with no judgement yet.
    if (this.baseYaw.length < this.th.baselineMinSamples) {
      this.baseYaw.push(this.yaw);
      this.basePitch.push(this.pitch);
      if (eyesKnown) {
        this.baseEyeSide.push(this.eyeSide as number);
        this.baseEyeDown.push(this.eyeDown as number);
      }
      return;
    }

    const dYaw = Math.abs(this.yaw - clamp(this.baseYaw.median(), this.th.baselineMaxYawDeg));
    const dPitch = Math.abs(this.pitch - clamp(this.basePitch.median(), this.th.baselineMaxPitchDeg));
    this.headOff = this.headOff
      ? dYaw >= this.th.headYawExitDeg || dPitch >= this.th.headPitchExitDeg
      : dYaw >= this.th.headYawEnterDeg || dPitch >= this.th.headPitchEnterDeg;
    const headSteady = !this.headOff && dYaw < this.th.eyeIgnoreYawDeg && dPitch < this.th.eyeIgnorePitchDeg;

    let eyesSteady = false;
    if (!headSteady) {
      this.eyesOff = false;
    } else if (eyesKnown && this.baseEyeSide.length < this.th.baselineMinSamples) {
      eyesSteady = true;
    } else if (eyesKnown) {
      const dSide = Math.abs((this.eyeSide as number) - clamp(this.baseEyeSide.median(), this.th.baselineMaxEyeSide));
      const dDown = (this.eyeDown as number) - clamp(this.baseEyeDown.median(), this.th.baselineMaxEyeDown);
      this.eyesOff = this.eyesOff
        ? dSide >= this.th.eyeSideExit || dDown >= this.th.eyeDownExit
        : dSide >= this.th.eyeSideEnter || dDown >= this.th.eyeDownEnter;
      eyesSteady = !this.eyesOff && dSide < this.th.eyeSideExit && dDown < this.th.eyeDownExit;
    }
    // A blink (eyes unreadable) keeps the previous eye state.

    // After warm-up the baseline only learns from looks at the screen, so
    // repeated glances cannot drag it toward the side they go to.
    if (headSteady) {
      this.baseYaw.push(this.yaw);
      this.basePitch.push(this.pitch);
    }
    if (eyesSteady) {
      this.baseEyeSide.push(this.eyeSide as number);
      this.baseEyeDown.push(this.eyeDown as number);
    }

    if (this.headOff || this.eyesOff) {
      if (this.offSince === null) this.offSince = now;
      this.offCue = this.headOff ? "head" : "eyes";
    } else {
      this.endLook(now);
    }
  }

  private endLook(now: number): void {
    if (this.offSince === null) return;
    if (now - this.offSince >= this.th.minEpisodeMs) this.episodes.push({ start: this.offSince, end: now });
    this.offSince = null;
  }

  private windowStats(now: number): { windowAwayMs: number; windowEpisodes: number } {
    const from = now - this.th.windowMs;
    let away = 0;
    let count = 0;
    for (const e of this.episodes) {
      away += e.end - Math.max(e.start, from);
      count += 1;
    }
    if (this.offSince !== null) {
      away += now - Math.max(this.offSince, from);
      if (now - this.offSince >= this.th.minEpisodeMs) count += 1;
    }
    return { windowAwayMs: Math.max(0, away), windowEpisodes: count };
  }

  private readings(faces: number): Omit<LiveWarningDebug, "off" | "offMs" | "windowAwayMs" | "windowEpisodes"> {
    const ready = this.baseYaw.length >= this.th.baselineMinSamples;
    const eyesReady = this.baseEyeSide.length >= this.th.baselineMinSamples;
    return {
      faces,
      yaw: this.yaw,
      pitch: this.pitch,
      eyeSide: this.eyeSide,
      eyeDown: this.eyeDown,
      blink: this.blink,
      dYaw: ready && this.yaw !== null ? this.yaw - clamp(this.baseYaw.median(), this.th.baselineMaxYawDeg) : null,
      dPitch: ready && this.pitch !== null ? this.pitch - clamp(this.basePitch.median(), this.th.baselineMaxPitchDeg) : null,
      dEyeSide:
        eyesReady && this.eyeSide !== null ? this.eyeSide - clamp(this.baseEyeSide.median(), this.th.baselineMaxEyeSide) : null,
      dEyeDown:
        eyesReady && this.eyeDown !== null ? this.eyeDown - clamp(this.baseEyeDown.median(), this.th.baselineMaxEyeDown) : null,
      baselineSamples: this.baseYaw.length,
    };
  }

  private maybeEvent(
    now: number,
    reason: LiveWarningReason,
    cue: LookCue | null,
    stats: { offMs?: number; windowAwayMs?: number; windowEpisodes?: number },
  ): LiveWarningEvent | null {
    const last = this.lastEventAt.get(reason);
    if (last !== undefined && now - last < this.th.eventCooldownMs) return null;
    this.lastEventAt.set(reason, now);
    const look = reason === "look_away" || reason === "glances";
    return {
      at: now,
      reason,
      cue: look ? cue : null,
      awayMs: reason === "look_away" ? Math.round(stats.offMs ?? 0) : reason === "glances" ? Math.round(stats.windowAwayMs ?? 0) : null,
      episodes: reason === "glances" ? stats.windowEpisodes ?? null : null,
    };
  }
}

/** One compact line set for the `?proctorDebug=1` readout under the self-view. */
export function formatLiveWarningDebug(d: LiveWarningDebug): string {
  const deg = (v: number | null) => (v === null ? "–" : `${Math.round(v)}°`);
  const num = (v: number | null) => (v === null ? "–" : v.toFixed(2));
  return [
    `faces ${d.faces} · base ${d.baselineSamples}`,
    `yaw ${deg(d.yaw)} Δ${deg(d.dYaw)} · pitch ${deg(d.pitch)} Δ${deg(d.dPitch)}`,
    `eyes side ${num(d.eyeSide)} Δ${num(d.dEyeSide)} · down ${num(d.eyeDown)} Δ${num(d.dEyeDown)} · blink ${num(d.blink)}`,
    `off ${d.off ?? "–"} ${(d.offMs / 1000).toFixed(1)}s · 30s window ${(d.windowAwayMs / 1000).toFixed(1)}s / ${d.windowEpisodes}`,
  ].join("\n");
}
