"use client";

import { useState } from "react";
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
import { runMicPermissionCheck } from "@/lib/student/student-service";
import type { MicPermissionState } from "@/lib/student/status";

interface MicTestClientProps {
  submissionId: string;
  interviewId: string;
}

export function MicTestClient({ submissionId, interviewId }: MicTestClientProps) {
  const t = useTranslations();
  const router = useRouter();
  const [perm, setPerm] = useState<MicPermissionState>("permission_required");
  const [recording, setRecording] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [playing, setPlaying] = useState(false);

  async function requestMic() {
    const result = await runMicPermissionCheck();
    if (result === "granted") setPerm("permission_granted");
    else setPerm("permission_denied");
  }

  function toggleRecording() {
    if (!recording && !recorded) {
      setRecording(true);
      setTimeout(() => {
        setRecording(false);
        setRecorded(true);
      }, 2200);
    } else if (recording) {
      setRecording(false);
      setRecorded(true);
    }
  }

  return (
    <StudentAppShell>
      <div className="page-narrow">
        <Link
          href={`/student/submissions/${submissionId}/lobby`}
          style={{ textDecoration: "none" }}
        >
          <button
            type="button"
            className="btn btn-ghost row"
            style={{ padding: "8px 0", gap: 8 }}
          >
            <span className="icon-flip">
              <BackIcon />
            </span>
            {t("micTest.back")}
          </button>
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
                  padding: "40px 24px",
                  borderRadius: 24,
                  background: "rgba(255,255,255,0.7)",
                  border: "1px solid rgba(230,238,247,0.9)",
                  boxShadow: recording
                    ? "0 0 40px rgba(251,113,133,0.25), inset 0 1px 0 rgba(255,255,255,0.9)"
                    : "0 0 30px rgba(125,211,252,0.18), inset 0 1px 0 rgba(255,255,255,0.9)",
                  textAlign: "center",
                  transition: "box-shadow .4s",
                }}
              >
                <div
                  style={{
                    height: 60,
                    transform: "scale(1.4)",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <Waveform variant={recording ? "pink" : "cyan"} />
                </div>
                <div
                  className="text-muted"
                  style={{ fontSize: 13, fontWeight: 600, marginTop: 24 }}
                >
                  {recording
                    ? t("micTest.recording")
                    : recorded
                      ? `${t("micTest.recordedListen")}${
                          playing ? ` · ${t("micTest.playing")}` : ""
                        }`
                      : t("micTest.tapToRecord")}
                </div>
              </div>

              <div
                className="row"
                style={{ gap: 16, marginTop: 32, justifyContent: "center" }}
              >
                <MicButton
                  recording={recording}
                  onClick={toggleRecording}
                  ariaLabel={t("micTest.tapToRecord")}
                >
                  {recording ? <XIcon size={24} /> : <MicIcon size={28} />}
                </MicButton>
                {recorded && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-lg"
                    onClick={() => {
                      setPlaying(true);
                      setTimeout(() => setPlaying(false), 2200);
                    }}
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
                    onClick={() => {
                      setRecorded(false);
                      setPlaying(false);
                    }}
                  >
                    <RepeatIcon size={16} /> {t("micTest.recordAgain")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div
          className="row"
          style={{ gap: 12, marginTop: 32, justifyContent: "flex-end" }}
        >
          <Link
            href={`/student/submissions/${submissionId}/lobby`}
            style={{ textDecoration: "none" }}
          >
            <button type="button" className="btn btn-secondary btn-lg">
              {t("common.cancel")}
            </button>
          </Link>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={!recorded}
            onClick={() => router.push(`/student/interviews/${interviewId}`)}
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
