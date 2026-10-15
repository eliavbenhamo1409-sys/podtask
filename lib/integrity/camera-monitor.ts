"use client";

import type { IntegrityClientEvent } from "./types";
import type { HeadPose } from "./head-pose";
import { headPoseFromMatrix } from "./head-pose";
import { PresenceTracker } from "./presence-tracker";
import type { EyeGaze, LiveWarning, LiveWarningDebug, LiveWarningEvent } from "./live-warning";
import { LiveWarningMonitor, eyeGazeFromBlendshapes } from "./live-warning";
import type { FaceWorkerRequest, FaceWorkerResponse } from "./face-worker";

export type CameraStatus =
  | "idle"
  | "starting"
  | "on"
  | "denied"
  | "unavailable"
  | "off";

/** Whether the on-device detector is producing observations. */
export type TrackingStatus = "idle" | "loading" | "on" | "unavailable" | "off";

export interface CameraMonitorOptions {
  onStatus: (status: CameraStatus) => void;
  onEvent: (event: IntegrityClientEvent) => void;
  getPlanQuestionId: () => string | null;
  onTracking?: (status: TrackingStatus, detail: string | null) => void;
  /** The warning sign on the self-view changed (null = gone). See `live-warning.ts`. */
  onWarning?: (warning: LiveWarning | null) => void;
  /** Per-frame readings behind the warning; only for tuning (`?proctorDebug=1`). */
  onDebug?: (debug: LiveWarningDebug) => void;
  /** Run the on-device face presence detector (MediaPipe). */
  detectFaces?: boolean;
  /** Also estimate head orientation (needs the landmarker's transformation matrix). */
  headPose?: boolean;
  /** A specific camera, from `listVideoInputs()`; omit for the default front camera. */
  deviceId?: string | null;
  /** Run the detector in a Web Worker when the browser allows it (default true). */
  useWorker?: boolean;
  /** Where the MediaPipe wasm runtime is served from. */
  wasmBasePath?: string;
  /** The face landmark model file. */
  modelAssetPath?: string;
  faceMissingAfterMs?: number;
  multipleFacesAfterMs?: number;
  /** Base sampling interval; adapts upward when inference is slow. */
  intervalMs?: number;
}

// Pinned runtime, same version as the npm package in package.json. Only
// the wasm runtime comes from the CDN; the model is served by this app and
// every frame stays in the browser.
export const MEDIAPIPE_WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.0/wasm";
export const FACE_LANDMARK_MODEL_PATH = "/models/face_landmarker.task";

/** Frames are analysed at this size; the self-view keeps the camera's own. */
const ANALYSIS_WIDTH = 320;
const ANALYSIS_HEIGHT = 240;
const DETECTOR_LOAD_TIMEOUT_MS = 30_000;
const FRAME_RESULT_TIMEOUT_MS = 6_000;
const NO_FRAMES_AFTER_MS = 4_000;
const MUTED_AFTER_MS = 3_000;
/** Sampling bands: [max average inference ms, interval ms]. */
const WORKER_BANDS: [number, number][] = [[250, 700], [600, 1200], [Infinity, 2000]];
const MAIN_BANDS: [number, number][] = [[150, 1000], [300, 1500], [Infinity, 2500]];

interface FrameResult {
  faces: number;
  pose: HeadPose | null;
  eyes: EyeGaze | null;
  inferenceMs: number;
}

interface Analyzer {
  readonly engine: "worker" | "main";
  analyze(video: HTMLVideoElement, ts: number): Promise<FrameResult>;
  close(): void;
}

/** Cameras the student can pick from (labels appear once permission was granted). */
export async function listVideoInputs(): Promise<{ deviceId: string; label: string }[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === "videoinput" && d.deviceId)
      .map((d) => ({ deviceId: d.deviceId, label: d.label }));
  } catch {
    return [];
  }
}

export function videoConstraints(deviceId?: string | null): MediaTrackConstraints {
  const base: MediaTrackConstraints = {
    width: { ideal: 640 },
    height: { ideal: 480 },
    frameRate: { ideal: 15, max: 30 },
  };
  return deviceId ? { ...base, deviceId: { exact: deviceId } } : { ...base, facingMode: "user" };
}

/**
 * Keeps the student's camera on during the interview and runs a small
 * on-device face landmarker, in a Web Worker when possible:
 *   face_missing / multiple_faces / head_away   via PresenceTracker
 *   integrity_warning      a warning sign was shown on the self-view
 *                          (LiveWarningMonitor: sustained or repeated looks
 *                          away, another person, no face)
 *   tracking_unavailable   the detector cannot run (no frames, muted track,
 *                          model failure): distinct from "no face"
 *   camera_off             the track ended or went silent (unplugged,
 *                          permission revoked, taken by another app)
 * No frame is ever uploaded or stored; the detector only yields a face
 * count, two head angles and a coarse eye direction. No identity or emotion
 * analysis is performed.
 */
export class CameraMonitor {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private video: HTMLVideoElement | null = null;
  private analyzer: Analyzer | null = null;
  private presence: PresenceTracker | null = null;
  private warnings: LiveWarningMonitor | null = null;
  private timer: number | null = null;
  private mutedTimer: number | null = null;
  private status: CameraStatus = "idle";
  private tracking: TrackingStatus = "idle";
  private stopped = false;
  private busy = false;
  private everStarted = false;
  private lastTs = 0;
  private lastCurrentTime = -1;
  private lastAdvanceAt = 0;
  private intervalMs: number;
  private inferenceAvg: number | null = null;
  private workerFailed = false;
  private readonly baseIntervalMs: number;

  constructor(private readonly opts: CameraMonitorOptions) {
    this.baseIntervalMs = opts.intervalMs ?? 700;
    this.intervalMs = this.baseIntervalMs;
  }

  get currentStatus(): CameraStatus {
    return this.status;
  }

  get trackingStatus(): TrackingStatus {
    return this.tracking;
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
      return this.setStatus("unavailable", "camera_unavailable", { reason: "unsupported" });
    }
    this.setStatus("starting");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: videoConstraints(this.opts.deviceId),
        audio: false,
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      if (this.opts.deviceId && name === "OverconstrainedError") {
        // The remembered camera is gone: fall back to any front camera.
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints(null),
            audio: false,
          });
        } catch (err2) {
          return this.failedToOpen(err2);
        }
      } else {
        return this.failedToOpen(err);
      }
    }
    if (this.stopped) {
      stream.getTracks().forEach((t) => t.stop());
      return this.status;
    }
    this.stream = stream;
    const [track] = stream.getVideoTracks();
    this.track = track ?? null;
    if (track) {
      track.addEventListener("ended", this.onTrackEnded);
      track.addEventListener("mute", this.onTrackMute);
      track.addEventListener("unmute", this.onTrackUnmute);
    }
    if (this.video) {
      this.video.srcObject = stream;
      void this.video.play().catch(() => {});
    }
    const reconnected = this.everStarted;
    this.everStarted = true;
    const detect = this.opts.detectFaces !== false;
    this.setStatus("on", reconnected ? "camera_reconnected" : "camera_started", {
      detector: detect,
      label: track?.label ? track.label.slice(0, 80) : undefined,
    });
    this.lastCurrentTime = -1;
    this.lastAdvanceAt = Date.now();

    if (detect) {
      this.presence ??= new PresenceTracker({
        onEvent: (e) => this.emit(e),
        getPlanQuestionId: this.opts.getPlanQuestionId,
        headPose: this.opts.headPose !== false,
        faceMissingAfterMs: this.opts.faceMissingAfterMs,
        multipleFacesAfterMs: this.opts.multipleFacesAfterMs,
      });
      this.warnings ??= new LiveWarningMonitor();
      if (this.analyzer) {
        this.setTracking("on", null);
        this.schedule();
      } else {
        void this.loadAnalyzer();
      }
    }
    return this.status;
  }

  stop(): void {
    this.stopped = true;
    const now = Date.now();
    this.presence?.flush(now);
    this.dropWarning();
    this.clearTimers();
    try {
      this.analyzer?.close();
    } catch {
      /* noop */
    }
    this.analyzer = null;
    this.busy = false;
    this.releaseStream();
    if (this.status === "on" || this.status === "starting") this.status = "off";
    this.setTracking("off", null);
  }

  async restart(): Promise<CameraStatus> {
    this.stop();
    return this.start();
  }

  // ---- internals ----

  private failedToOpen(err: unknown): CameraStatus {
    const name = err instanceof Error ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return this.setStatus("denied", "camera_denied");
    }
    return this.setStatus("unavailable", "camera_unavailable", { reason: name || "unknown" });
  }

  private releaseStream(): void {
    if (this.track) {
      this.track.removeEventListener("ended", this.onTrackEnded);
      this.track.removeEventListener("mute", this.onTrackMute);
      this.track.removeEventListener("unmute", this.onTrackUnmute);
    }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    if (this.video) this.video.srcObject = null;
  }

  private clearTimers(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.mutedTimer !== null) {
      window.clearTimeout(this.mutedTimer);
      this.mutedTimer = null;
    }
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

  private setTracking(status: TrackingStatus, detail: string | null): void {
    if (status === this.tracking) return;
    this.tracking = status;
    try {
      this.opts.onTracking?.(status, detail);
    } catch {
      /* noop */
    }
  }

  private emit(event: IntegrityClientEvent): void {
    try {
      this.opts.onEvent(event);
    } catch {
      /* noop */
    }
  }

  /** Presence can no longer be observed: close what is open and take the sign down. */
  private markUnavailable(reason: string, at: number): void {
    this.presence?.markUnavailable(reason, at);
    this.dropWarning();
  }

  private dropWarning(): void {
    if (this.warnings?.reset()) this.notifyWarning(null);
  }

  private notifyWarning(warning: LiveWarning | null): void {
    try {
      this.opts.onWarning?.(warning ? { ...warning } : null);
    } catch {
      /* noop */
    }
  }

  private emitWarning(event: LiveWarningEvent): void {
    const payload: Record<string, unknown> = { reason: event.reason };
    if (event.cue) payload.cue = event.cue;
    if (event.awayMs !== null) payload.away_ms = event.awayMs;
    if (event.episodes !== null) payload.episodes = event.episodes;
    this.emit({
      kind: "integrity_warning",
      startedAt: new Date(event.at).toISOString(),
      planQuestionId: this.opts.getPlanQuestionId(),
      payload,
    });
  }

  private onTrackEnded = (): void => {
    if (this.stopped) return;
    const now = Date.now();
    this.markUnavailable("camera_ended", now);
    this.clearTimers();
    this.setStatus("off", "camera_off", { reason: "ended" });
    this.setTracking("unavailable", "camera_ended");
  };

  private onTrackMute = (): void => {
    if (this.stopped || this.mutedTimer !== null) return;
    // A muted track delivers no frames (lid closed, camera taken by another
    // app, OS privacy switch). Short mutes happen on device changes: wait.
    this.mutedTimer = window.setTimeout(() => {
      this.mutedTimer = null;
      if (this.stopped || !this.track?.muted) return;
      this.markUnavailable("camera_muted", Date.now());
      this.setStatus("off", "camera_off", { reason: "muted" });
      this.setTracking("unavailable", "camera_muted");
    }, MUTED_AFTER_MS);
  };

  private onTrackUnmute = (): void => {
    if (this.stopped) return;
    if (this.mutedTimer !== null) {
      window.clearTimeout(this.mutedTimer);
      this.mutedTimer = null;
      return;
    }
    if (this.status === "off" && this.track && this.track.readyState === "live") {
      this.lastAdvanceAt = Date.now();
      this.setStatus("on", "camera_reconnected", { reason: "unmuted" });
      if (this.analyzer) {
        this.setTracking("on", null);
        this.schedule();
      }
    }
  };

  private async loadAnalyzer(): Promise<void> {
    this.setTracking("loading", null);
    const wasmBase = this.opts.wasmBasePath ?? MEDIAPIPE_WASM_BASE;
    const modelPath = this.opts.modelAssetPath ?? FACE_LANDMARK_MODEL_PATH;
    const headPose = this.opts.headPose !== false;
    let analyzer: Analyzer | null = null;
    let lastError = "unknown";
    const useWorker =
      this.opts.useWorker !== false &&
      !this.workerFailed &&
      typeof Worker !== "undefined" &&
      typeof createImageBitmap === "function";
    if (useWorker) {
      try {
        analyzer = await withTimeout(
          createWorkerAnalyzer({ wasmBase, modelPath, headPose, onCrash: this.onWorkerCrash }),
          DETECTOR_LOAD_TIMEOUT_MS,
          "detector_timeout",
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        this.workerFailed = true;
        analyzer = null;
      }
    }
    if (!analyzer && !this.stopped) {
      try {
        analyzer = await withTimeout(
          createMainThreadAnalyzer({ wasmBase, modelPath, headPose }),
          DETECTOR_LOAD_TIMEOUT_MS,
          "detector_timeout",
        );
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        analyzer = null;
      }
    }
    if (this.stopped) {
      analyzer?.close();
      return;
    }
    if (!analyzer) {
      // The camera still works as a plain self-view; presence events are
      // simply not produced, and the report says so.
      const reason = lastError === "detector_timeout" ? "detector_timeout" : "detector_failed";
      this.markUnavailable(reason, Date.now());
      this.setTracking("unavailable", reason);
      return;
    }
    this.analyzer = analyzer;
    this.intervalMs = analyzer.engine === "worker" ? this.baseIntervalMs : Math.max(this.baseIntervalMs, 1000);
    this.setTracking("on", analyzer.engine);
    this.schedule();
  }

  private onWorkerCrash = (message: string): void => {
    if (this.stopped) return;
    this.workerFailed = true;
    try {
      this.analyzer?.close();
    } catch {
      /* noop */
    }
    this.analyzer = null;
    this.busy = false;
    this.markUnavailable("worker_crashed", Date.now());
    this.setTracking("loading", message);
    // One more attempt, on the main thread.
    void this.loadAnalyzer();
  };

  private schedule(): void {
    if (this.timer !== null || this.stopped) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.analyzeOnce();
    } catch {
      /* never let the detector break the room */
    }
    this.schedule();
  }

  private async analyzeOnce(): Promise<void> {
    const video = this.video;
    const analyzer = this.analyzer;
    const presence = this.presence;
    if (!video || !analyzer || !presence || this.status !== "on" || this.busy) return;
    const now = Date.now();
    // Frames do not advance in a hidden tab; the activity monitor records that.
    if (document.visibilityState === "hidden") {
      this.lastAdvanceAt = now;
      this.dropWarning();
      return;
    }
    if (video.readyState < 2 || video.videoWidth === 0) {
      if (now - this.lastAdvanceAt > NO_FRAMES_AFTER_MS) {
        this.markUnavailable("no_frames", now);
        this.setTracking("unavailable", "no_frames");
      }
      return;
    }
    // Frame-freshness watchdog: a live track whose picture stopped moving.
    if (video.currentTime !== this.lastCurrentTime) {
      this.lastCurrentTime = video.currentTime;
      this.lastAdvanceAt = now;
    } else if (now - this.lastAdvanceAt > NO_FRAMES_AFTER_MS) {
      this.markUnavailable("no_frames", now);
      this.setTracking("unavailable", "no_frames");
      return;
    }

    this.busy = true;
    let result: FrameResult;
    try {
      const ts = Math.max(this.lastTs + 1, Math.round(performance.now()));
      this.lastTs = ts;
      result = await withTimeout(analyzer.analyze(video, ts), FRAME_RESULT_TIMEOUT_MS, "frame_timeout");
    } catch (err) {
      this.busy = false;
      const message = err instanceof Error ? err.message : String(err);
      if (analyzer.engine === "worker") {
        this.onWorkerCrash(message);
      } else {
        this.markUnavailable("detector_failed", Date.now());
        this.setTracking("unavailable", "detector_failed");
      }
      return;
    }
    this.busy = false;
    if (this.stopped) return;
    const at = Date.now();
    presence.observe({ at, faces: result.faces, pose: result.pose });
    const warnings = this.warnings;
    if (warnings) {
      const { faceMissing, multipleFaces } = presence.state;
      const out = warnings.observe({ at, faces: result.faces, pose: result.pose, eyes: result.eyes, faceMissing, multipleFaces });
      if (out.event) this.emitWarning(out.event);
      if (out.changed) this.notifyWarning(warnings.warning);
      const debug = warnings.debug;
      if (debug && this.opts.onDebug) {
        try {
          this.opts.onDebug(debug);
        } catch {
          /* noop */
        }
      }
    }
    if (this.tracking !== "on") this.setTracking("on", analyzer.engine);
    this.adapt(result.inferenceMs, analyzer.engine);
  }

  /** Adaptive sampling: slower inference means fewer samples, never a busier UI thread. */
  private adapt(inferenceMs: number, engine: "worker" | "main"): void {
    this.inferenceAvg =
      this.inferenceAvg === null ? inferenceMs : this.inferenceAvg * 0.7 + inferenceMs * 0.3;
    const bands = engine === "worker" ? WORKER_BANDS : MAIN_BANDS;
    const band = bands.find(([max]) => (this.inferenceAvg ?? 0) <= max) ?? bands[bands.length - 1];
    this.intervalMs = Math.max(this.baseIntervalMs, band[1]);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = window.setTimeout(() => reject(new Error(label)), ms);
    p.then(
      (v) => {
        window.clearTimeout(id);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(id);
        reject(e);
      },
    );
  });
}

interface AnalyzerConfig {
  wasmBase: string;
  modelPath: string;
  headPose: boolean;
}

function createWorkerAnalyzer(
  cfg: AnalyzerConfig & { onCrash: (message: string) => void },
): Promise<Analyzer> {
  return new Promise<Analyzer>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./face-worker.ts", import.meta.url), { type: "module" });
    } catch (err) {
      reject(err instanceof Error ? err : new Error("worker_unavailable"));
      return;
    }
    let ready = false;
    let waiting: { ts: number; resolve: (r: FrameResult) => void; reject: (e: Error) => void } | null = null;
    const post = (msg: FaceWorkerRequest, transfer?: Transferable[]) => {
      if (transfer) worker.postMessage(msg, transfer);
      else worker.postMessage(msg);
    };
    worker.onerror = (ev) => {
      const message = ev instanceof ErrorEvent && ev.message ? ev.message : "worker_error";
      if (!ready) reject(new Error(message));
      else {
        waiting?.reject(new Error(message));
        waiting = null;
        cfg.onCrash(message);
      }
    };
    worker.onmessage = (ev: MessageEvent<FaceWorkerResponse>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "ready") {
        ready = true;
        resolve({
          engine: "worker",
          analyze(video, ts) {
            return new Promise<FrameResult>((res, rej) => {
              if (waiting) {
                rej(new Error("busy"));
                return;
              }
              createImageBitmap(video, {
                resizeWidth: ANALYSIS_WIDTH,
                resizeHeight: ANALYSIS_HEIGHT,
                resizeQuality: "low",
              }).then(
                (bitmap) => {
                  waiting = { ts, resolve: res, reject: rej };
                  post({ type: "frame", bitmap, ts }, [bitmap]);
                },
                (e) => rej(e instanceof Error ? e : new Error("bitmap_failed")),
              );
            });
          },
          close() {
            waiting?.reject(new Error("closed"));
            waiting = null;
            worker.terminate();
          },
        });
        return;
      }
      if (msg.type === "result") {
        const w = waiting;
        waiting = null;
        w?.resolve({
          faces: msg.faces,
          pose:
            msg.yaw !== null && msg.pitch !== null
              ? { yawDeg: msg.yaw, pitchDeg: msg.pitch, rollDeg: 0 }
              : null,
          eyes:
            msg.eyeH !== null && msg.eyeV !== null
              ? { h: msg.eyeH, v: msg.eyeV, blink: msg.blink ?? 0 }
              : null,
          inferenceMs: msg.inferenceMs,
        });
        return;
      }
      if (msg.type === "error") {
        if (msg.stage === "init" || !ready) {
          reject(new Error(msg.message));
          worker.terminate();
          return;
        }
        const w = waiting;
        waiting = null;
        w?.reject(new Error(msg.message));
      }
    };
    post({
      type: "init",
      wasmBase: cfg.wasmBase,
      modelPath: cfg.modelPath,
      headPose: cfg.headPose,
      numFaces: 2,
    });
  });
}

async function createMainThreadAnalyzer(cfg: AnalyzerConfig): Promise<Analyzer> {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(cfg.wasmBase);
  const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: cfg.modelPath, delegate: "CPU" },
    runningMode: "VIDEO",
    numFaces: 2,
    outputFaceBlendshapes: cfg.headPose,
    outputFacialTransformationMatrixes: cfg.headPose,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  return {
    engine: "main",
    async analyze(video, ts) {
      const started = performance.now();
      const result = landmarker.detectForVideo(video, ts);
      const faces = result.faceLandmarks.length;
      let pose: HeadPose | null = null;
      let eyes: EyeGaze | null = null;
      if (cfg.headPose && faces === 1) {
        const m = result.facialTransformationMatrixes?.[0];
        pose = m ? headPoseFromMatrix(m.data) : null;
        eyes = eyeGazeFromBlendshapes(result.faceBlendshapes?.[0]?.categories);
      }
      return { faces, pose, eyes, inferenceMs: Math.round(performance.now() - started) };
    },
    close() {
      landmarker.close();
    },
  };
}
