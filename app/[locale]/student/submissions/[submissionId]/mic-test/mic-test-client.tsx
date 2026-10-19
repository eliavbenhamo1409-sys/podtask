"use client";

/**
 * Mic test — a REAL check before the live interview:
 *   1. ask for microphone permission and keep the stream,
 *   2. record a short clip with MediaRecorder (max 10 s) while showing the
 *      live input level,
 *   3. play the clip back through an <audio> element,
 *   4. warn when the clip was silent (muted mic / wrong device).
 * The stream is released when the student leaves; the interview room opens
 * its own.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { useRouter, Link } from "@/lib/i18n/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { Badge } from "@/components/podtask/chip";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { MicButton } from "@/components/podtask/mic-button";
import { Waveform } from "@/components/podtask/waveform";
import {
  ArrowIcon,
  BackIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RepeatIcon,
  XIcon,
} from "@/components/podtask/icons";
import type { MicPermissionState } from "@/lib/student/status";
import type { CameraMode } from "@/lib/integrity/settings";
import { listVideoInputs, videoConstraints } from "@/lib/integrity/camera-monitor";
import { PREFERRED_CAMERA_KEY } from "@/lib/integrity/preferences";
import { CAMERA_EXEMPTION_REASONS, type CameraExemptionReason } from "@/lib/integrity/types";
import { recordCameraExemption } from "@/lib/student/student-service";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils";
import {
  ForestCamPlaceholder,
  ForestCamStatus,
  ForestCamWaiting,
  ForestCardHead,
  ForestMicActions,
  ForestMicDenied,
  ForestMicDevice,
  ForestMicFooter,
  ForestMicHeader,
  ForestMicLevel,
  ForestMicPermission,
  ForestReadyCard,
} from "./forest-mic-parts";
import type { InterviewLanguage } from "@/lib/student/interview-language";

interface MicTestClientProps {
  submissionId: string;
  interviewId: string;
  /** off = no camera in this interview; on = asked; required = must be granted to start. */
  cameraMode?: CameraMode;
  /** Interview facts for the forest summary card (not used by the classic layout). */
  questionCount?: number;
  estimatedMinutes?: number;
  language?: InterviewLanguage;
}

type RecorderPhase = "idle" | "recording" | "recorded";
type CameraCheck = "idle" | "starting" | "on" | "denied" | "unavailable";
/** Does a granted camera actually deliver moving frames? */
type CameraSignal = "unknown" | "ok" | "none";
type ExemptionState = "idle" | "saving" | "done" | "error";

const FRAME_CHECK_MS = 3000;

const MAX_RECORD_MS = 10_000;
// RMS below this for the whole clip = nothing reached the mic.
const SILENCE_PEAK = 0.03;
const METER_FPS = 15;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((c) => MediaRecorder.isTypeSupported(c));
}

export function MicTestClient({
  submissionId,
  interviewId,
  cameraMode = "on",
  questionCount = 0,
  estimatedMinutes = 0,
  language,
}: MicTestClientProps) {
  const t = useTranslations();
  const router = useRouter();
  // Forest is a skin: the same elements (video, audio, recorder) stay mounted
  // in the same places; only classes and presentational siblings change.
  const forest = useTheme().theme === "forest";
  const [micLabel, setMicLabel] = useState<string | null>(null);
  const [perm, setPerm] = useState<MicPermissionState>("permission_required");
  const [cam, setCam] = useState<CameraCheck>("idle");
  const [camSignal, setCamSignal] = useState<CameraSignal>("unknown");
  const [camDevices, setCamDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [camDeviceId, setCamDeviceId] = useState<string | null>(null);
  const [exemptionOpen, setExemptionOpen] = useState(false);
  const [exemptionReason, setExemptionReason] = useState<CameraExemptionReason>("accessibility");
  const [exemptionNote, setExemptionNote] = useState("");
  const [exemptionState, setExemptionState] = useState<ExemptionState>("idle");
  const camStreamRef = useRef<MediaStream | null>(null);
  const camVideoRef = useRef<HTMLVideoElement | null>(null);
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [playing, setPlaying] = useState(false);
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [silent, setSilent] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [clipUrl, setClipUrl] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const peakRef = useRef(0);
  const clipUrlRef = useRef<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    if (ctx) void ctx.close().catch(() => {});
    setLevel(0);
  }, []);

  const startMeter = useCallback((stream: MediaStream) => {
    const Ctx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    audioCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    let last = 0;
    const tick = (now: number) => {
      rafRef.current = requestAnimationFrame(tick);
      if (now - last < 1000 / METER_FPS) return;
      last = now;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.min(1, Math.sqrt(sum / buf.length));
      peakRef.current = Math.max(peakRef.current, rms);
      setLevel(rms);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const clearTimers = useCallback(() => {
    if (stopTimerRef.current !== null) {
      window.clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    if (tickRef.current !== null) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const releaseStream = useCallback(() => {
    stopMeter();
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    streamRef.current?.getTracks().forEach((tk) => tk.stop());
    streamRef.current = null;
    camStreamRef.current?.getTracks().forEach((tk) => tk.stop());
    camStreamRef.current = null;
  }, [stopMeter]);

  // Camera check: a mirrored preview so the student sees what the camera
  // sees, a device picker when there are several, and a frame check (a
  // granted camera can still deliver no picture: covered lens, stuck
  // driver). The frames stay in the browser; the room opens its own stream.
  async function requestCamera(deviceId: string | null = camDeviceId) {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setCam("unavailable");
      return;
    }
    setCam("starting");
    setCamSignal("unknown");
    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints(deviceId),
          audio: false,
        });
      } catch (err) {
        // The remembered camera is gone: fall back to any front camera.
        if (deviceId && err instanceof Error && err.name === "OverconstrainedError") {
          stream = await navigator.mediaDevices.getUserMedia({
            video: videoConstraints(null),
            audio: false,
          });
        } else {
          throw err;
        }
      }
      camStreamRef.current?.getTracks().forEach((tk) => tk.stop());
      camStreamRef.current = stream;
      const el = camVideoRef.current;
      if (el) {
        el.srcObject = stream;
        void el.play().catch(() => {});
      }
      setCam("on");
      const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId ?? deviceId ?? null;
      setCamDeviceId(activeId);
      try {
        if (activeId) window.sessionStorage.setItem(PREFERRED_CAMERA_KEY, activeId);
      } catch {
        /* private mode */
      }
      setCamDevices(await listVideoInputs());
      void checkFrames(stream, el);
    } catch (err) {
      const name = err instanceof Error ? err.name : "";
      setCam(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
    }
  }

  async function checkFrames(stream: MediaStream, el: HTMLVideoElement | null) {
    const started = performance.now();
    const t0 = el?.currentTime ?? 0;
    while (performance.now() - started < FRAME_CHECK_MS) {
      await new Promise((r) => window.setTimeout(r, 250));
      if (camStreamRef.current !== stream) return; // superseded
      if (el && el.readyState >= 2 && el.videoWidth > 0 && el.currentTime > t0) {
        setCamSignal("ok");
        return;
      }
    }
    if (camStreamRef.current === stream) setCamSignal("none");
  }

  async function submitExemption() {
    if (exemptionState === "saving") return;
    setExemptionState("saving");
    let ok = false;
    try {
      ok = await recordCameraExemption(interviewId, exemptionReason, exemptionNote.trim() || null);
    } catch {
      ok = false;
    }
    setExemptionState(ok ? "done" : "error");
  }

  // Release everything on unmount (back link, cancel, navigation).
  useEffect(() => {
    return () => {
      clearTimers();
      releaseStream();
      if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    };
  }, [clearTimers, releaseStream]);

  async function requestMic() {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setPerm("permission_denied");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setMicLabel(stream.getAudioTracks()[0]?.label || null);
      setUnsupported(typeof MediaRecorder === "undefined");
      setPerm("permission_granted");
    } catch {
      setPerm("permission_denied");
    }
  }

  const stopRecording = useCallback(() => {
    clearTimers();
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") rec.stop();
  }, [clearTimers]);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") {
      setUnsupported(true);
      return;
    }
    const mime = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      setUnsupported(true);
      return;
    }
    chunksRef.current = [];
    peakRef.current = 0;
    setSilent(false);
    setSeconds(0);
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      stopMeter();
      const blob = new Blob(chunksRef.current, {
        type: rec.mimeType || mime || "audio/webm",
      });
      const url = URL.createObjectURL(blob);
      if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
      clipUrlRef.current = url;
      setClipUrl(url);
      setSilent(peakRef.current < SILENCE_PEAK);
      setPhase("recorded");
    };
    recorderRef.current = rec;
    rec.start(250);
    setPhase("recording");
    startMeter(stream);
    const startedAt = Date.now();
    tickRef.current = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    stopTimerRef.current = window.setTimeout(stopRecording, MAX_RECORD_MS);
  }

  // The big mic button is the one control students reach for, so from the
  // "recorded" state (including a silent clip) it discards the old clip and
  // starts a fresh take, same as "record again".
  function toggleRecording() {
    if (phase === "recording") {
      stopRecording();
      return;
    }
    if (phase === "recorded") recordAgain();
    startRecording();
  }

  function togglePlayback() {
    const el = audioElRef.current;
    if (!el || !clipUrl) return;
    if (playing) {
      el.pause();
      setPlaying(false);
      return;
    }
    el.src = clipUrl;
    el.currentTime = 0;
    void el
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }

  function recordAgain() {
    const el = audioElRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
    }
    setPlaying(false);
    if (clipUrlRef.current) URL.revokeObjectURL(clipUrlRef.current);
    clipUrlRef.current = null;
    setClipUrl(null);
    setSilent(false);
    setSeconds(0);
    setPhase("idle");
  }

  function startInterview() {
    clearTimers();
    releaseStream();
    router.push(`/student/interviews/${interviewId}`);
  }

  const recording = phase === "recording";
  const recorded = phase === "recorded";
  const cameraGate = cameraMode !== "required" || cam === "on" || exemptionState === "done";
  const canStart = (recorded || unsupported) && cameraGate;
  // What still stands between the student and the room (forest footer).
  const need: "mic" | "recording" | "camera" | null =
    perm !== "permission_granted"
      ? "mic"
      : !(recorded || unsupported)
        ? "recording"
        : !cameraGate
          ? "camera"
          : null;
  const lobbyHref = `/student/submissions/${submissionId}/lobby`;

  return (
    <StudentAppShell>
      <div
        className={
          forest ? cn("page fp-page fp-mic", cameraMode === "off" && "fp-mic-solo") : "page-narrow"
        }
      >
        {forest ? null : (
          <Link href={lobbyHref} className="btn btn-ghost row" style={{ padding: "8px 0", gap: 8 }}>
            <span className="icon-flip">
              <BackIcon />
            </span>
            {t("micTest.back")}
          </Link>
        )}

        {forest ? (
          <ForestMicHeader withCamera={cameraMode !== "off"} />
        ) : (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            style={{ marginTop: 24 }}
          >
            <Eyebrow showDot>{t("micTest.eyebrow")}</Eyebrow>
            <h1 className="display" style={{ fontSize: 38 }}>
              {t("micTest.title")}
            </h1>
            <p className="subtitle">{t("micTest.subtitle")}</p>
          </motion.div>
        )}

        <div
          className={forest ? "card fp-card fp-mic-card" : "card-hero"}
          style={forest ? undefined : { padding: 48, marginTop: 32 }}
        >
          {forest ? (
            <ForestCardHead
              title={t("forestPrep.micCardTitle")}
              body={t("forestPrep.micCardBody")}
            />
          ) : null}
          {perm === "permission_required" && forest && (
            <ForestMicPermission onNotNow={() => setPerm("permission_denied")} onAllow={requestMic} />
          )}
          {perm === "permission_required" && !forest && (
            <div style={{ textAlign: "center" }}>
              <div
                style={{
                  position: "relative",
                  width: 120,
                  height: 120,
                  margin: "0 auto 24px",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: "50%",
                    background:
                      "radial-gradient(circle, rgba(125,211,252,0.3), transparent 70%)",
                    filter: "blur(8px)",
                  }}
                />
                <div
                  style={{
                    position: "relative",
                    width: 120,
                    height: 120,
                    borderRadius: "50%",
                    background:
                      "linear-gradient(135deg, rgba(125,211,252,0.25), rgba(253,164,175,0.25))",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow:
                      "0 16px 40px rgba(14,165,233,0.18), inset 0 2px 0 rgba(255,255,255,0.6)",
                  }}
                >
                  <div
                    style={{
                      width: 80,
                      height: 80,
                      borderRadius: "50%",
                      background: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "rgb(var(--cyan))",
                    }}
                  >
                    <MicIcon size={32} />
                  </div>
                </div>
              </div>
              <h3
                style={{
                  fontSize: 22,
                  fontWeight: 800,
                  letterSpacing: "-0.02em",
                  margin: 0,
                }}
              >
                {t("micTest.permTitle")}
              </h3>
              <p
                className="subtitle"
                style={{ maxWidth: 420, margin: "8px auto 0" }}
              >
                {t("micTest.permBody")}
              </p>
              <div
                className="row"
                style={{ gap: 12, marginTop: 32, justifyContent: "center" }}
              >
                <button
                  type="button"
                  className="btn btn-secondary btn-lg"
                  onClick={() => setPerm("permission_denied")}
                >
                  {t("micTest.notNow")}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-lg"
                  onClick={requestMic}
                >
                  <MicIcon size={18} /> {t("micTest.allowMic")}
                </button>
              </div>
            </div>
          )}

          {perm === "permission_denied" && forest && <ForestMicDenied onRetry={requestMic} />}
          {perm === "permission_denied" && !forest && (
            <div
              className="card"
              style={{
                padding: 24,
                background: "rgba(255,241,245,0.6)",
                boxShadow: "none",
                borderRadius: 20,
                textAlign: "center",
              }}
            >
              <div style={{ fontWeight: 800, color: "rgb(var(--pink-rose))" }}>
                {t("micTest.permDeniedTitle")}
              </div>
              <div className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
                {t("micTest.permDeniedBody")}
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ marginTop: 24 }}
                onClick={requestMic}
              >
                {t("micTest.tryAgain")}
              </button>
            </div>
          )}

          {perm === "permission_granted" && (
            <div className={forest ? "fp-mic-body" : undefined}>
              {forest ? (
                <ForestMicDevice label={micLabel} />
              ) : (
              <div className="between">
                <Badge variant="mint" showDot>
                  {t("micTest.micConnected")}
                </Badge>
                <div
                  className="text-muted"
                  style={{ fontSize: 13, fontWeight: 600 }}
                >
                  {t("micTest.defaultMic")}
                </div>
              </div>
              )}

              {forest ? (
                <ForestMicLevel
                  recording={recording}
                  recorded={recorded}
                  silent={silent}
                  unsupported={unsupported}
                  level={level}
                  seconds={seconds}
                  maxSeconds={MAX_RECORD_MS / 1000}
                />
              ) : (
              <div
                style={{
                  marginTop: 24,
                  padding: "40px 24px 28px",
                  borderRadius: 24,
                  background: "rgba(255,255,255,0.7)",
                  border: "1px solid rgba(230,238,247,0.9)",
                  boxShadow: recording
                    ? `0 0 ${40 + Math.round(level * 60)}px rgba(251,113,133,0.25), inset 0 1px 0 rgba(255,255,255,0.9)`
                    : "0 0 30px rgba(125,211,252,0.18), inset 0 1px 0 rgba(255,255,255,0.9)",
                  textAlign: "center",
                  transition: "box-shadow .2s",
                }}
              >
                <div
                  style={{
                    height: 60,
                    transform: `scale(${recording ? 1.4 + Math.min(1, level * 3) * 0.6 : 1.4})`,
                    transition: "transform .12s linear",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <Waveform variant={recording || playing ? "pink" : "cyan"} />
                </div>

                {/* Live input meter while recording */}
                <div
                  aria-label={t("micTest.levelLabel")}
                  style={{
                    width: 220,
                    height: 6,
                    borderRadius: 3,
                    margin: "22px auto 0",
                    background: "rgba(148,163,184,0.18)",
                    overflow: "hidden",
                    opacity: recording ? 1 : 0.35,
                    transition: "opacity .2s",
                  }}
                >
                  <div
                    style={{
                      width: `${Math.min(100, Math.round(level * 400))}%`,
                      height: "100%",
                      background:
                        "linear-gradient(90deg, #7DD3FC, #FB7185)",
                      transition: "width .08s linear",
                    }}
                  />
                </div>

                <div
                  className="text-muted"
                  style={{ fontSize: 13, fontWeight: 600, marginTop: 18 }}
                >
                  {recording
                    ? `${t("micTest.recording")} · ${seconds}s`
                    : recorded
                      ? `${t("micTest.recordedListen")}${
                          playing ? ` · ${t("micTest.playing")}` : ""
                        }`
                      : t("micTest.tapToRecord")}
                </div>
                <div
                  className="text-muted"
                  style={{ fontSize: 12, marginTop: 6, opacity: 0.8 }}
                >
                  {recording
                    ? t("micTest.recordingLimit")
                    : recorded
                      ? t("micTest.recordedSeconds", { seconds: Math.max(1, seconds) })
                      : ""}
                </div>

                {recorded && silent && (
                  <div
                    role="status"
                    style={{
                      marginTop: 16,
                      padding: "10px 14px",
                      borderRadius: 12,
                      background: "rgba(255,228,230,0.8)",
                      border: "1px solid rgba(244,63,94,0.3)",
                      color: "#9F1239",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    {t("micTest.silentRecording")}
                  </div>
                )}
                {unsupported && (
                  <div
                    role="status"
                    className="text-muted"
                    style={{ marginTop: 16, fontSize: 13, fontWeight: 600 }}
                  >
                    {t("micTest.recorderUnsupported")}
                  </div>
                )}
              </div>
              )}

              {forest ? (
                <ForestMicActions
                  recording={recording}
                  recorded={recorded}
                  playing={playing}
                  unsupported={unsupported}
                  onToggleRecording={toggleRecording}
                  onTogglePlayback={togglePlayback}
                />
              ) : (
              <div
                className="row"
                style={{ gap: 16, marginTop: 32, justifyContent: "center" }}
              >
                <MicButton
                  recording={recording}
                  onClick={toggleRecording}
                  ariaLabel={
                    recorded ? t("micTest.recordAgain") : t("micTest.tapToRecord")
                  }
                  disabled={unsupported}
                >
                  {recording ? <XIcon size={24} /> : <MicIcon size={28} />}
                </MicButton>
                {recorded && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-lg"
                    onClick={togglePlayback}
                  >
                    {playing ? (
                      <>
                        <PauseIcon /> {t("micTest.playingNow")}
                      </>
                    ) : (
                      <>
                        <PlayIcon /> {t("micTest.playRecording")}
                      </>
                    )}
                  </button>
                )}
                {recorded && (
                  <button
                    type="button"
                    className="btn btn-ghost row"
                    style={{ gap: 8 }}
                    onClick={recordAgain}
                  >
                    <RepeatIcon size={16} /> {t("micTest.recordAgain")}
                  </button>
                )}
              </div>
              )}

              <audio
                ref={audioElRef}
                hidden
                playsInline
                onEnded={() => setPlaying(false)}
                onPause={() => setPlaying(false)}
              />
            </div>
          )}
        </div>

        {cameraMode !== "off" && perm === "permission_granted" ? (
          <div
            className={forest ? "card fp-card fp-cam-card" : "card"}
            style={forest ? undefined : { padding: 28, marginTop: 24 }}
          >
            {forest ? (
              <ForestCardHead
                title={t("forestPrep.camCardTitle")}
                body={t("forestPrep.camCardBody")}
              />
            ) : (
            <div className="between" style={{ gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 17 }}>
                  {t("micTest.cameraTitle")}
                </div>
                <div className="text-muted" style={{ fontSize: 13, marginTop: 4, maxWidth: 440 }}>
                  {t("micTest.cameraBody")}
                </div>
              </div>
              <Badge
                variant={cam === "on" ? (camSignal === "none" ? "amber" : "mint") : "neutral"}
                showDot={cam === "on" && camSignal !== "none"}
              >
                {cam === "on"
                  ? camSignal === "none"
                    ? t("micTest.cameraNoSignal")
                    : t("micTest.cameraOk")
                  : cam === "denied"
                    ? t("micTest.cameraDenied")
                    : cam === "unavailable"
                      ? t("micTest.cameraUnavailable")
                      : t("micTest.cameraTitle")}
              </Badge>
            </div>
            )}
            {/* Forest flattens this row (display: contents) so the preview,
                status, picker and help line can be ordered inside the card. */}
            <div
              className={forest ? "fp-cam-stage" : "row"}
              style={
                forest
                  ? undefined
                  : { gap: 20, marginTop: 20, alignItems: "center", flexWrap: "wrap" }
              }
            >
              <video
                ref={camVideoRef}
                className="mic-cam-preview"
                autoPlay
                muted
                playsInline
                style={{ display: cam === "on" ? "block" : "none" }}
              />
              {cam !== "on" && !forest ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void requestCamera()}
                  disabled={cam === "starting"}
                >
                  {cam === "denied" || cam === "unavailable"
                    ? t("micTest.cameraTryAgain")
                    : t("micTest.cameraAllow")}
                </button>
              ) : null}
              <div
                className={forest ? "fp-cam-help" : "text-muted"}
                style={forest ? undefined : { fontSize: 13, flex: "1 1 220px", lineHeight: 1.5 }}
              >
                {cam === "denied"
                  ? t("micTest.cameraDeniedBody")
                  : cam === "on" && camSignal === "none"
                    ? t("micTest.cameraNoSignalBody")
                    : cam === "on"
                      ? t("micTest.cameraKeepOn")
                      : cameraMode === "required"
                        ? t("micTest.cameraRequired")
                        : t("micTest.cameraOptional")}
              </div>
              {forest && cam !== "on" ? (
                <ForestCamPlaceholder>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void requestCamera()}
                    disabled={cam === "starting"}
                  >
                    {cam === "denied" || cam === "unavailable"
                      ? t("micTest.cameraTryAgain")
                      : t("micTest.cameraAllow")}
                  </button>
                </ForestCamPlaceholder>
              ) : null}
              {forest ? <ForestCamStatus cam={cam} signal={camSignal} /> : null}
            </div>
            {cam === "on" && camDevices.length > 1 ? (
              <div
                className={forest ? "fp-cam-pick" : "row"}
                style={
                  forest
                    ? undefined
                    : { gap: 10, marginTop: 14, flexWrap: "wrap", alignItems: "center" }
                }
              >
                <label
                  htmlFor="mic-cam-select"
                  style={forest ? undefined : { fontSize: 13, fontWeight: 700 }}
                >
                  {t("micTest.cameraPick")}
                </label>
                <select
                  id="mic-cam-select"
                  className="mic-cam-select"
                  value={camDeviceId ?? ""}
                  onChange={(e) => void requestCamera(e.target.value || null)}
                >
                  {camDevices.map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || t("micTest.cameraDefaultLabel", { n: i + 1 })}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <p
              className={forest ? "fp-cam-privacy" : "text-muted"}
              style={forest ? undefined : { fontSize: 12, lineHeight: 1.55, margin: "14px 0 0" }}
            >
              {t("micTest.cameraPrivacy")}
            </p>
            {cameraMode === "required" && cam !== "on" ? (
              exemptionState === "done" ? (
                <div className="mic-exemption" role="status">
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{t("micTest.exemptionDone")}</div>
                  <div className="text-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                    {t("micTest.exemptionDoneBody")}
                  </div>
                </div>
              ) : exemptionOpen ? (
                <div className="mic-exemption">
                  <div style={{ fontWeight: 800, fontSize: 14 }}>{t("micTest.exemptionTitle")}</div>
                  <div className="text-muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                    {t("micTest.exemptionBody")}
                  </div>
                  <label htmlFor="mic-exemption-reason" style={{ fontSize: 13, fontWeight: 700 }}>
                    {t("micTest.exemptionReason")}
                  </label>
                  <select
                    id="mic-exemption-reason"
                    className="mic-cam-select"
                    value={exemptionReason}
                    onChange={(e) => setExemptionReason(e.target.value as CameraExemptionReason)}
                  >
                    {CAMERA_EXEMPTION_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {t(`micTest.exemption_${r}`)}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="mic-exemption-note" style={{ fontSize: 13, fontWeight: 700 }}>
                    {t("micTest.exemptionNote")}
                  </label>
                  <textarea
                    id="mic-exemption-note"
                    maxLength={200}
                    value={exemptionNote}
                    onChange={(e) => setExemptionNote(e.target.value)}
                  />
                  {exemptionState === "error" ? (
                    <div role="alert" style={{ fontSize: 13, color: "rgb(var(--pink-rose))", fontWeight: 600 }}>
                      {t("micTest.exemptionError")}
                    </div>
                  ) : null}
                  <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => void submitExemption()}
                      disabled={exemptionState === "saving"}
                    >
                      {exemptionState === "saving" ? t("consent.saving") : t("micTest.exemptionSubmit")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => setExemptionOpen(false)}
                      disabled={exemptionState === "saving"}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ marginTop: 12, padding: "6px 0", fontSize: 13, fontWeight: 700 }}
                  onClick={() => setExemptionOpen(true)}
                >
                  {t("micTest.exemptionLink")}
                </button>
              )
            ) : null}
          </div>
        ) : null}
        {forest && cameraMode !== "off" && perm !== "permission_granted" ? <ForestCamWaiting /> : null}
        {forest ? (
          <ForestReadyCard
            mic={perm === "permission_granted" ? "done" : "pending"}
            test={
              recorded ? (silent ? "silent" : "done") : unsupported ? "unsupported" : "pending"
            }
            camera={
              cameraMode === "off"
                ? null
                : {
                    check:
                      exemptionState === "done"
                        ? cam === "on"
                          ? "done"
                          : "exempt"
                        : cam === "on"
                          ? camSignal === "none"
                            ? "noSignal"
                            : "done"
                          : cam === "denied" || cam === "unavailable"
                            ? cam
                            : "pending",
                    optional: cameraMode !== "required",
                  }
            }
            questionCount={questionCount}
            minutes={estimatedMinutes}
            language={language ?? null}
          />
        ) : null}

        {forest ? (
          <ForestMicFooter
            backHref={lobbyHref}
            canStart={canStart}
            need={need}
            onStart={startInterview}
          />
        ) : (
        <div
          className="row"
          style={{ gap: 12, marginTop: 32, justifyContent: "flex-end" }}
        >
          <Link href={lobbyHref} className="btn btn-secondary btn-lg">
              {t("common.cancel")}
            </Link>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={!canStart}
            onClick={startInterview}
          >
            {t("micTest.startInterview")}
            <span className="icon-flip">
              <ArrowIcon />
            </span>
          </button>
        </div>
        )}
      </div>
    </StudentAppShell>
  );
}
