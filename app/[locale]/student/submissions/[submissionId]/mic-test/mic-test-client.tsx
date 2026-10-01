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

interface MicTestClientProps {
  submissionId: string;
  interviewId: string;
}

type RecorderPhase = "idle" | "recording" | "recorded";

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

export function MicTestClient({ submissionId, interviewId }: MicTestClientProps) {
  const t = useTranslations();
  const router = useRouter();
  const [perm, setPerm] = useState<MicPermissionState>("permission_required");
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
  }, [stopMeter]);

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

  function toggleRecording() {
    if (phase === "recording") stopRecording();
    else if (phase === "idle") startRecording();
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
  const canStart = recorded || unsupported;

  return (
    <StudentAppShell>
      <div className="page-narrow">
        <Link href={`/student/submissions/${submissionId}/lobby`} className="btn btn-ghost row" style={{ padding: "8px 0", gap: 8 }}>
            <span className="icon-flip">
              <BackIcon />
            </span>
            {t("micTest.back")}
          </Link>

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

        <div className="card-hero" style={{ padding: 48, marginTop: 32 }}>
          {perm === "permission_required" && (
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

          {perm === "permission_denied" && (
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
            <div>
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

              <div
                className="row"
                style={{ gap: 16, marginTop: 32, justifyContent: "center" }}
              >
                <MicButton
                  recording={recording}
                  onClick={toggleRecording}
                  ariaLabel={t("micTest.tapToRecord")}
                  disabled={recorded || unsupported}
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

        <div
          className="row"
          style={{ gap: 12, marginTop: 32, justifyContent: "flex-end" }}
        >
          <Link href={`/student/submissions/${submissionId}/lobby`} className="btn btn-secondary btn-lg">
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
      </div>
    </StudentAppShell>
  );
}
