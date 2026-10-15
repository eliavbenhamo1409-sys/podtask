/**
 * Web Worker: runs the MediaPipe Face Landmarker off the UI thread.
 *
 * The room posts one downscaled `ImageBitmap` at a time (1–2 per second);
 * the worker answers with a FEW NUMBERS: how many faces, and, when exactly
 * one is tracked, its yaw / pitch and a coarse eye direction (from three
 * blendshape sums, see `live-warning.ts`). Landmarks, blendshapes and pixels
 * never leave this worker, nothing is stored, and no identity model runs.
 * See `camera-monitor.ts` for the main-thread side and the fallback.
 */
import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { headPoseFromMatrix } from "./head-pose";
import { eyeGazeFromBlendshapes } from "./live-warning";

export interface FaceWorkerInit {
  type: "init";
  wasmBase: string;
  modelPath: string;
  headPose: boolean;
  numFaces: number;
}

export interface FaceWorkerFrame {
  type: "frame";
  bitmap: ImageBitmap;
  ts: number;
}

export type FaceWorkerRequest = FaceWorkerInit | FaceWorkerFrame;

export type FaceWorkerResponse =
  | { type: "ready" }
  | {
      type: "result";
      ts: number;
      faces: number;
      yaw: number | null;
      pitch: number | null;
      eyeH: number | null;
      eyeV: number | null;
      blink: number | null;
      inferenceMs: number;
    }
  | { type: "error"; stage: "init" | "frame"; message: string };

const ctx = self as unknown as {
  postMessage: (message: FaceWorkerResponse, transfer?: Transferable[]) => void;
  addEventListener: (type: "message", listener: (ev: MessageEvent<FaceWorkerRequest>) => void) => void;
};

let landmarker: FaceLandmarker | null = null;
let wantPose = false;
let lastTs = 0;

async function init(msg: FaceWorkerInit): Promise<void> {
  const vision = await import("@mediapipe/tasks-vision");
  const fileset = await vision.FilesetResolver.forVisionTasks(msg.wasmBase);
  landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: msg.modelPath, delegate: "CPU" },
    runningMode: "VIDEO",
    numFaces: msg.numFaces,
    // Head pose and eye direction travel together (the `head_pose` setting).
    outputFaceBlendshapes: msg.headPose,
    outputFacialTransformationMatrixes: msg.headPose,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  wantPose = msg.headPose;
}

function analyze(msg: FaceWorkerFrame): FaceWorkerResponse {
  if (!landmarker) return { type: "error", stage: "frame", message: "not_ready" };
  const started = performance.now();
  // MediaPipe requires strictly increasing timestamps.
  const ts = Math.max(lastTs + 1, Math.round(msg.ts));
  lastTs = ts;
  const result = landmarker.detectForVideo(msg.bitmap, ts);
  const faces = result.faceLandmarks.length;
  let yaw: number | null = null;
  let pitch: number | null = null;
  let eyeH: number | null = null;
  let eyeV: number | null = null;
  let blink: number | null = null;
  if (wantPose && faces === 1) {
    const m = result.facialTransformationMatrixes?.[0];
    const pose = m ? headPoseFromMatrix(m.data) : null;
    if (pose) {
      yaw = pose.yawDeg;
      pitch = pose.pitchDeg;
    }
    const eyes = eyeGazeFromBlendshapes(result.faceBlendshapes?.[0]?.categories);
    if (eyes) {
      eyeH = eyes.h;
      eyeV = eyes.v;
      blink = eyes.blink;
    }
  }
  return {
    type: "result",
    ts: msg.ts,
    faces,
    yaw,
    pitch,
    eyeH,
    eyeV,
    blink,
    inferenceMs: Math.round(performance.now() - started),
  };
}

ctx.addEventListener("message", (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "init") {
    init(msg)
      .then(() => ctx.postMessage({ type: "ready" }))
      .catch((err: unknown) => {
        ctx.postMessage({
          type: "error",
          stage: "init",
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return;
  }
  if (msg.type === "frame") {
    let response: FaceWorkerResponse;
    try {
      response = analyze(msg);
    } catch (err) {
      response = {
        type: "error",
        stage: "frame",
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      try {
        msg.bitmap.close();
      } catch {
        /* already closed */
      }
    }
    ctx.postMessage(response);
  }
});
