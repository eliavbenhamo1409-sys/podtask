/**
 * Head orientation from a MediaPipe face transformation matrix, plus a small
 * state machine that turns a stream of (noisy) orientations into "the head
 * has been turned away for a while" intervals.
 *
 * What this is NOT: eye tracking. The angles describe where the head points
 * with a few degrees of error; the eyes can look elsewhere. Thresholds are
 * deliberately conservative and the report labels the result as head
 * orientation, never as gaze. Pure module, no DOM: unit-tested in
 * `tests/integrity/head-pose.test.ts`.
 */

export interface HeadPose {
  /** Rotation about the vertical axis (turning left / right), degrees. */
  yawDeg: number;
  /** Rotation about the horizontal axis (nodding down / up), degrees. */
  pitchDeg: number;
  /** Tilt, degrees. */
  rollDeg: number;
}

const RAD = 180 / Math.PI;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Decomposes the rotation part of a 4x4 transformation matrix.
 *
 * MediaPipe packs `facialTransformationMatrixes[i].data` column-major (the
 * translation sits at indices 12..14, as three.js `Matrix4.fromArray`
 * expects). The canonical face looks along +Z with +Y up, so turning the
 * head is a rotation about Y (yaw) and nodding is a rotation about X
 * (pitch). With R = Rz(roll) · Ry(yaw) · Rx(pitch):
 *   yaw   = asin(-r20)
 *   pitch = atan2(r21, r22)
 *   roll  = atan2(r10, r00)
 * Reading the matrix in the wrong layout would flip the signs but keep the
 * magnitudes, which is why thresholds below use absolute values and the
 * report only names the axis.
 */
export function headPoseFromMatrix(data: ArrayLike<number>): HeadPose | null {
  if (!data || data.length < 16) return null;
  const at = (row: number, col: number) => data[col * 4 + row];
  const r00 = at(0, 0);
  const r10 = at(1, 0);
  const r20 = at(2, 0);
  const r21 = at(2, 1);
  const r22 = at(2, 2);
  if (![r00, r10, r20, r21, r22].every((v) => Number.isFinite(v))) return null;
  const yaw = Math.asin(clamp(-r20, -1, 1));
  const pitch = Math.atan2(r21, r22);
  const roll = Math.atan2(r10, r00);
  return { yawDeg: yaw * RAD, pitchDeg: pitch * RAD, rollDeg: roll * RAD };
}

export interface HeadAwayThresholds {
  /** |yaw| at which the head counts as turned away. */
  yawEnterDeg: number;
  /** |yaw| below which it counts as back (hysteresis). */
  yawExitDeg: number;
  /** |pitch| at which the head counts as turned down / up. */
  pitchEnterDeg: number;
  pitchExitDeg: number;
  /** The orientation must stay away this long before an interval opens. */
  dwellMs: number;
  /** ...and stay back this long before it closes (a glance back is not a return). */
  returnMs: number;
  /** Exponential smoothing factor for the angles, 0..1 (1 = no smoothing). */
  smoothing: number;
}

export const DEFAULT_HEAD_AWAY: HeadAwayThresholds = {
  yawEnterDeg: 35,
  yawExitDeg: 25,
  pitchEnterDeg: 30,
  pitchExitDeg: 20,
  dwellMs: 4000,
  returnMs: 1500,
  smoothing: 0.5,
};

export type HeadAwayAxis = "yaw" | "pitch";

export interface HeadAwayOpen {
  startedAt: number;
  axis: HeadAwayAxis;
  peakDeg: number;
}

export type HeadAwayTransition =
  | { type: "open"; startedAt: number; axis: HeadAwayAxis }
  | { type: "close"; startedAt: number; endedAt: number; axis: HeadAwayAxis; peakDeg: number }
  | null;

/**
 * Feeds smoothed orientations through enter / exit thresholds with a dwell
 * time. Natural movement (a short turn to think, a nod) never opens an
 * interval because it ends before `dwellMs`.
 */
export class HeadAwayTracker {
  private yaw: number | null = null;
  private pitch: number | null = null;
  private awaySince: number | null = null;
  private awayAxis: HeadAwayAxis | null = null;
  private backSince: number | null = null;
  private open: HeadAwayOpen | null = null;

  constructor(private readonly th: HeadAwayThresholds = DEFAULT_HEAD_AWAY) {}

  get isOpen(): boolean {
    return this.open !== null;
  }

  get smoothed(): HeadPose | null {
    return this.yaw === null || this.pitch === null
      ? null
      : { yawDeg: this.yaw, pitchDeg: this.pitch, rollDeg: 0 };
  }

  /** The face left the frame or tracking stopped: nothing is known. */
  reset(now: number): HeadAwayTransition {
    this.yaw = null;
    this.pitch = null;
    this.awaySince = null;
    this.awayAxis = null;
    this.backSince = null;
    return this.closeOpen(now);
  }

  observe(pose: HeadPose, now: number): HeadAwayTransition {
    const a = this.th.smoothing;
    this.yaw = this.yaw === null ? pose.yawDeg : this.yaw + a * (pose.yawDeg - this.yaw);
    this.pitch = this.pitch === null ? pose.pitchDeg : this.pitch + a * (pose.pitchDeg - this.pitch);
    const ay = Math.abs(this.yaw);
    const ap = Math.abs(this.pitch);

    if (this.open) {
      const back = ay < this.th.yawExitDeg && ap < this.th.pitchExitDeg;
      if (back) {
        if (this.backSince === null) this.backSince = now;
        if (now - this.backSince >= this.th.returnMs) {
          const closedAt = this.backSince;
          this.backSince = null;
          this.awaySince = null;
          this.awayAxis = null;
          return this.closeOpen(closedAt);
        }
      } else {
        this.backSince = null;
        const peak = this.open.axis === "yaw" ? ay : ap;
        if (peak > this.open.peakDeg) this.open.peakDeg = peak;
      }
      return null;
    }

    const awayYaw = ay >= this.th.yawEnterDeg;
    const awayPitch = ap >= this.th.pitchEnterDeg;
    if (awayYaw || awayPitch) {
      if (this.awaySince === null) {
        this.awaySince = now;
        this.awayAxis = awayYaw ? "yaw" : "pitch";
      }
      if (now - this.awaySince >= this.th.dwellMs) {
        const axis = this.awayAxis ?? "yaw";
        this.open = { startedAt: this.awaySince, axis, peakDeg: axis === "yaw" ? ay : ap };
        return { type: "open", startedAt: this.awaySince, axis };
      }
    } else {
      this.awaySince = null;
      this.awayAxis = null;
    }
    return null;
  }

  private closeOpen(now: number): HeadAwayTransition {
    if (!this.open) return null;
    const o = this.open;
    this.open = null;
    return {
      type: "close",
      startedAt: o.startedAt,
      endedAt: Math.max(o.startedAt, now),
      axis: o.axis,
      peakDeg: Math.round(o.peakDeg),
    };
  }
}
