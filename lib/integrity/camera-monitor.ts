"use client";

import type { IntegrityClientEvent } from "./types";

export type CameraStatus =
  | "idle"
  | "starting"
  | "on"
  | "denied"
  | "unavailable"
  | "off";

export interface CameraMonitorOptions {
  onStatus: (status: CameraStatus) => void;
  onEvent: (event: IntegrityClientEvent) => void;
  getPlanQuestionId: () => string | null;
  /** Run the on-device face presence detector (MediaPipe). */
  detectFaces?: boolean;
  /** Where the MediaPipe wasm runtime is served from. */
  wasmBasePath?: string;
  /** The face detection model file. */
  modelAssetPath?: string;
  faceMissingAfterMs?: number;
  multipleFacesAfterMs?: number;
  intervalMs?: number;
}

// Pinned runtime, same version as the npm package in package.json. Only
// the wasm runtime comes from the CDN; the model is served by this app and
// every frame stays in the browser.
export const MEDIAPIPE_WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
export const FACE_MODEL_PATH = "/models/blaze_face_short_range.tflite";

interface Detector {
  detectForVideo(
    video: HTMLVideoElement,
    timestampMs: number,
  ): { detections: unknown[] };
  close(): void;
}

/**
 * Keeps the student's camera on during the interview and runs a small
 * on-device face presence detector:
 *   face_missing     no face in the frame for a while (start/end + duration)
 *   multiple_faces   more than one face for a few seconds (start/end)
 *   camera_off       the track ended (unplugged, permission revoked)
 * No frame is ever uploaded or stored; the detector only yields a count.
 * No identity, emotion or gaze analysis is performed.
 */
export class CameraMonitor {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private detector: Detector | null = null;
  private timer: number | null = null;
  private status: CameraStatus = "idle";
  private stopped = false;
  private missingSince: number | null = null;
  private missingOpen: { startedAt: number; question: string | null } | null = null;
  private multiSince: number | null = null;
  private multiOpen: { startedAt: number; question: string | null } | null = null;
  private lastTimestamp = 0;
  private everStarted = false;

  private readonly faceMissingAfterMs: number;
  private readonly multipleFacesAfterMs: number;
  private readonly intervalMs: number;

  constructor(private readonly opts: CameraMonitorOptions) {
    this.faceMissingAfterMs = opts.faceMissingAfterMs ?? 8000;
    this.multipleFacesAfterMs = opts.multipleFacesAfterMs ?? 3000;
    this.intervalMs = opts.intervalMs ?? 500;
  }

  get currentStatus(): CameraStatus {
    return this.status;
  }

  attachVideo(video: HTMLVideoElement | null): void {
    this.video = video;
    if (video && this.stream) {
      video.srcObject = this.stream;
      void video.play().catch(() => {});
    }
  }

  async start(): Promise<CameraStatus> {
    this.stopped = false;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      return this.setStatus("unavailable", "camera_unavailable");
    }
    this.setStatus("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 }, facingMode: "user" },
        audio: false,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        return this.setStatus("denied", "camera_denied");
      }
      return this.setStatus("unavailable", "camera_unavailable", { reason: name || "unknown" });
    }
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return this.status;
    }
    this.stream = stream;
    const [track] = stream.getVideoTracks();
    if (track) {
      track.addEventListener("ended", this.onTrackEnded);
    }
    if (this.video) {
      this.video.srcObject = stream;
      void this.video.play().catch(() => {});
    }
    const reconnected = this.everStarted;
    this.everStarted = true;
    this.setStatus("on", reconnected ? "camera_reconnected" : "camera_started", {
      detector: this.opts.detectFaces !== false,
    });

    if (this.opts.detectFaces !== false) {
      void this.loadDetector();
    }
    return this.status;
  }

  stop(): void {
    this.stopped = true;
    const now = Date.now();
    this.closeMissing(now);
    this.closeMulti(now);
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.detector?.close();
    } catch {
      /* noop */
    }
    this.detector = null;
    this.stream?.getTracks().forEach((t) => {
      t.removeEventListener("ended", this.onTrackEnded);
      t.stop();
    });
    this.stream = null;
    if (this.video) this.video.srcObject = null;
    if (this.status === "on" || this.status === "starting") this.status = "off";
  }

  async restart(): Promise<CameraStatus> {
    this.stop();
    return this.start();
  }

  private setStatus(
    status: CameraStatus,
    eventKind?: IntegrityClientEvent["kind"],
    payload?: Record<string, unknown>,
  ): CameraStatus {
    this.status = status;
    try {
      this.opts.onStatus(status);
    } catch {
      /* noop */
    }
    if (eventKind) {
      this.emit({
        kind: eventKind,
        startedAt: new Date().toISOString(),
        planQuestionId: this.opts.getPlanQuestionId(),
        payload,
      });
    }
    return status;
  }

  private emit(event: IntegrityClientEvent): void {
    try {
      this.opts.onEvent(event);
    } catch {
      /* noop */
    }
  }

  private onTrackEnded = (): void => {
    if (this.stopped) return;
    const now = Date.now();
    this.closeMissing(now);
    this.closeMulti(now);
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
    this.setStatus("off", "camera_off");
  };

  private async loadDetector(): Promise<void> {
    try {
      const vision = await import("@mediapipe/tasks-vision");
      if (this.stopped) return;
      const fileset = await vision.FilesetResolver.forVisionTasks(
        this.opts.wasmBasePath ?? MEDIAPIPE_WASM_BASE,
      );
      if (this.stopped) return;
      const detector = await vision.FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: this.opts.modelAssetPath ?? FACE_MODEL_PATH,
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        minDetectionConfidence: 0.5,
      });
      if (this.stopped) {
        detector.close();
        return;
      }
      this.detector = detector as unknown as Detector;
      this.timer = window.setInterval(this.tick, this.intervalMs);
    } catch {
      // The camera still works as a plain self-view; presence events are
      // simply not produced. Recorded once so the report can say so.
      this.emit({
        kind: "camera_started",
        startedAt: new Date().toISOString(),
        planQuestionId: this.opts.getPlanQuestionId(),
        payload: { detector: false, reason: "detector_unavailable" },
      });
    }
  }

  private tick = (): void => {
    const video = this.video;
    const detector = this.detector;
    if (!video || !detector || this.status !== "on") return;
    if (video.readyState < 2 || video.videoWidth === 0) return;
    if (document.visibilityState === "hidden") return; // frames do not advance
    let count = 0;
    try {
      const ts = Math.max(this.lastTimestamp + 1, Math.round(performance.now()));
      this.lastTimestamp = ts;
      count = detector.detectForVideo(video, ts).detections.length;
    } catch {
      return;
    }
    const now = Date.now();
    const question = this.opts.getPlanQuestionId();

    if (count === 0) {
      if (this.missingSince === null) this.missingSince = now;
      if (!this.missingOpen && now - this.missingSince >= this.faceMissingAfterMs) {
        this.missingOpen = { startedAt: this.missingSince, question };
      }
    } else {
      this.missingSince = null;
      this.closeMissing(now);
    }

    if (count >= 2) {
      if (this.multiSince === null) this.multiSince = now;
      if (!this.multiOpen && now - this.multiSince >= this.multipleFacesAfterMs) {
        this.multiOpen = { startedAt: this.multiSince, question };
      }
    } else {
      this.multiSince = null;
      this.closeMulti(now);
    }
  };

  private closeMissing(now: number): void {
    if (!this.missingOpen) return;
    const open = this.missingOpen;
    this.missingOpen = null;
    this.emit({
      kind: "face_missing",
      startedAt: new Date(open.startedAt).toISOString(),
      endedAt: new Date(now).toISOString(),
      durationMs: Math.max(0, now - open.startedAt),
      planQuestionId: open.question,
    });
  }

  private closeMulti(now: number): void {
    if (!this.multiOpen) return;
    const open = this.multiOpen;
    this.multiOpen = null;
    this.emit({
      kind: "multiple_faces",
      startedAt: new Date(open.startedAt).toISOString(),
      endedAt: new Date(now).toISOString(),
      durationMs: Math.max(0, now - open.startedAt),
      planQuestionId: open.question,
    });
  }
}
