/**
 * Turns a stream of per-frame observations (how many faces, where the head
 * points) into integrity interval events with noise filtering:
 *
 *   face_missing         no face for `faceMissingAfterMs` in a row
 *   multiple_faces       two or more faces for `multipleFacesAfterMs` in a row
 *   head_away            the head turned away for `dwellMs` (HeadAwayTracker)
 *   tracking_unavailable the detector could not run (camera muted, no new
 *                        frames, model failure): closes any open presence
 *                        interval because nothing is known any more
 *
 * Every interval is emitted twice with the same `eventId` (open, close), see
 * `types.ts`. A single frame with a face resets the no-face countdown; a
 * face must be seen for `presentToCloseMs` before a no-face interval closes,
 * so one false positive in a dark room does not split an absence in two.
 * Pure module, no DOM: unit-tested in `tests/integrity/presence-tracker.test.ts`.
 */
import type { HeadPose, HeadAwayThresholds } from "./head-pose";
import { DEFAULT_HEAD_AWAY, HeadAwayTracker } from "./head-pose";
import type { IntegrityClientEvent } from "./types";
import { newEventId } from "./types";

export interface PresenceSample {
  /** Wall-clock ms (Date.now()). */
  at: number;
  faces: number;
  /** Orientation of the (single) tracked face; null when unknown. */
  pose?: HeadPose | null;
}

export interface PresenceTrackerOptions {
  onEvent: (event: IntegrityClientEvent) => void;
  getPlanQuestionId: () => string | null;
  faceMissingAfterMs?: number;
  presentToCloseMs?: number;
  multipleFacesAfterMs?: number;
  multipleFacesClearMs?: number;
  /** Set false to skip head orientation entirely. */
  headPose?: boolean;
  headAway?: Partial<HeadAwayThresholds>;
}

export const PRESENCE_DEFAULTS = {
  faceMissingAfterMs: 5000,
  presentToCloseMs: 800,
  multipleFacesAfterMs: 2000,
  multipleFacesClearMs: 1500,
} as const;

interface OpenInterval {
  id: string;
  startedAt: number;
  question: string | null;
}

export type TrackingUnavailableReason =
  | "detector_failed"
  | "detector_timeout"
  | "no_frames"
  | "camera_muted"
  | "worker_crashed"
  | "unsupported";

export class PresenceTracker {
  private readonly faceMissingAfterMs: number;
  private readonly presentToCloseMs: number;
  private readonly multipleFacesAfterMs: number;
  private readonly multipleFacesClearMs: number;
  private readonly head: HeadAwayTracker | null;

  private missingSince: number | null = null;
  private presentSince: number | null = null;
  private missingOpen: OpenInterval | null = null;

  private multiSince: number | null = null;
  private multiClearSince: number | null = null;
  private multiOpen: OpenInterval | null = null;

  private headOpen: OpenInterval | null = null;
  private unavailableOpen: (OpenInterval & { reason: string }) | null = null;

  private samples = 0;

  constructor(private readonly opts: PresenceTrackerOptions) {
    this.faceMissingAfterMs = opts.faceMissingAfterMs ?? PRESENCE_DEFAULTS.faceMissingAfterMs;
    this.presentToCloseMs = opts.presentToCloseMs ?? PRESENCE_DEFAULTS.presentToCloseMs;
    this.multipleFacesAfterMs = opts.multipleFacesAfterMs ?? PRESENCE_DEFAULTS.multipleFacesAfterMs;
    this.multipleFacesClearMs = opts.multipleFacesClearMs ?? PRESENCE_DEFAULTS.multipleFacesClearMs;
    this.head =
      opts.headPose === false
        ? null
        : new HeadAwayTracker({ ...DEFAULT_HEAD_AWAY, ...(opts.headAway ?? {}) });
  }

  get sampleCount(): number {
    return this.samples;
  }

  get state(): {
    faceMissing: boolean;
    multipleFaces: boolean;
    headAway: boolean;
    unavailable: string | null;
  } {
    return {
      faceMissing: this.missingOpen !== null,
      multipleFaces: this.multiOpen !== null,
      headAway: this.headOpen !== null,
      unavailable: this.unavailableOpen?.reason ?? null,
    };
  }

  /** One analysed frame. */
  observe(sample: PresenceSample): void {
    const now = sample.at;
    this.samples += 1;
    if (this.unavailableOpen) this.closeUnavailable(now);
    const question = this.opts.getPlanQuestionId();

    // ---- no face ----
    if (sample.faces === 0) {
      this.presentSince = null;
      if (this.missingSince === null) this.missingSince = now;
      if (!this.missingOpen && now - this.missingSince >= this.faceMissingAfterMs) {
        this.missingOpen = { id: newEventId(), startedAt: this.missingSince, question };
        this.emitOpen("face_missing", this.missingOpen);
      }
    } else {
      this.missingSince = null;
      if (this.missingOpen) {
        if (this.presentSince === null) this.presentSince = now;
        if (now - this.presentSince >= this.presentToCloseMs) {
          const closedAt = this.presentSince;
          this.presentSince = null;
          this.closeInterval("face_missing", this.missingOpen, closedAt, {});
          this.missingOpen = null;
        }
      }
    }

    // ---- more than one face ----
    if (sample.faces >= 2) {
      this.multiClearSince = null;
      if (this.multiSince === null) this.multiSince = now;
      if (!this.multiOpen && now - this.multiSince >= this.multipleFacesAfterMs) {
        this.multiOpen = { id: newEventId(), startedAt: this.multiSince, question };
        this.emitOpen("multiple_faces", this.multiOpen, { faces: sample.faces });
      }
    } else {
      this.multiSince = null;
      if (this.multiOpen) {
        if (this.multiClearSince === null) this.multiClearSince = now;
        if (now - this.multiClearSince >= this.multipleFacesClearMs) {
          const closedAt = this.multiClearSince;
          this.multiClearSince = null;
          this.closeInterval("multiple_faces", this.multiOpen, closedAt, {});
          this.multiOpen = null;
        }
      }
    }

    // ---- head orientation (one tracked face only) ----
    if (this.head) {
      const transition =
        sample.faces === 1 && sample.pose
          ? this.head.observe(sample.pose, now)
          : this.head.reset(now);
      if (transition?.type === "open") {
        this.headOpen = { id: newEventId(), startedAt: transition.startedAt, question };
        this.emitOpen("head_away", this.headOpen, { axis: transition.axis });
      } else if (transition?.type === "close" && this.headOpen) {
        this.closeInterval("head_away", this.headOpen, transition.endedAt, {
          axis: transition.axis,
          peak_deg: transition.peakDeg,
          closed_by: sample.faces === 1 ? "returned" : "face_lost",
        });
        this.headOpen = null;
      }
    }
  }

  /**
   * The detector cannot see anything right now. Open presence intervals are
   * closed (we no longer know) and a `tracking_unavailable` interval opens.
   */
  markUnavailable(reason: TrackingUnavailableReason | string, at: number): void {
    if (this.unavailableOpen) return;
    this.closeAllPresence(at, "tracking_unavailable");
    this.unavailableOpen = {
      id: newEventId(),
      startedAt: at,
      question: this.opts.getPlanQuestionId(),
      reason,
    };
    this.emitOpen("tracking_unavailable", this.unavailableOpen, { reason });
  }

  /** Stop: close everything that is still open at `at`. */
  flush(at: number): void {
    this.closeAllPresence(at, "stopped");
    if (this.unavailableOpen) this.closeUnavailable(at);
    this.missingSince = null;
    this.multiSince = null;
    this.presentSince = null;
    this.multiClearSince = null;
  }

  private closeAllPresence(at: number, closedBy: string): void {
    if (this.missingOpen) {
      this.closeInterval("face_missing", this.missingOpen, at, { closed_by: closedBy });
      this.missingOpen = null;
    }
    if (this.multiOpen) {
      this.closeInterval("multiple_faces", this.multiOpen, at, { closed_by: closedBy });
      this.multiOpen = null;
    }
    if (this.headOpen) {
      const t = this.head?.reset(at);
      this.closeInterval("head_away", this.headOpen, at, {
        closed_by: closedBy,
        ...(t?.type === "close" ? { axis: t.axis, peak_deg: t.peakDeg } : {}),
      });
      this.headOpen = null;
    }
  }

  private closeUnavailable(at: number): void {
    if (!this.unavailableOpen) return;
    const open = this.unavailableOpen;
    this.unavailableOpen = null;
    this.closeInterval("tracking_unavailable", open, at, { reason: open.reason });
  }

  private emitOpen(
    kind: IntegrityClientEvent["kind"],
    open: OpenInterval,
    payload: Record<string, unknown> = {},
  ): void {
    this.emit({
      eventId: open.id,
      kind,
      startedAt: new Date(open.startedAt).toISOString(),
      endedAt: null,
      durationMs: null,
      planQuestionId: open.question,
      payload: { phase: "open", ...payload },
    });
  }

  private closeInterval(
    kind: IntegrityClientEvent["kind"],
    open: OpenInterval,
    endedAtMs: number,
    payload: Record<string, unknown>,
  ): void {
    const ended = Math.max(open.startedAt, endedAtMs);
    this.emit({
      eventId: open.id,
      kind,
      startedAt: new Date(open.startedAt).toISOString(),
      endedAt: new Date(ended).toISOString(),
      durationMs: ended - open.startedAt,
      planQuestionId: open.question,
      payload: { phase: "close", ...payload },
    });
  }

  private emit(event: IntegrityClientEvent): void {
    try {
      this.opts.onEvent(event);
    } catch {
      /* never let telemetry break the room */
    }
  }
}
