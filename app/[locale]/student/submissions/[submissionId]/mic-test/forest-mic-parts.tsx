"use client";

/**
 * Presentational pieces of the forest mic / camera check. They hold no state,
 * refs or effects: the recorder, the camera stream, the <video> and the
 * <audio> all stay in MicTestClient, mounted once whatever the theme.
 */

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { JourneySteps } from "@/components/student/journey-steps";
import {
  ArrowIcon,
  CameraIcon,
  CheckIcon,
  ClockIcon,
  GlobeIcon,
  ListIcon,
  MicIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  StopIcon,
} from "@/components/podtask/icons";

import type { InterviewLanguage } from "@/lib/student/interview-language";

type Tone = "ok" | "idle" | "amber" | "danger" | "rec";

/** The languages' own names, as in the lobby picker. */
const LANGUAGE_NAMES: Record<InterviewLanguage, string> = {
  he: "עברית",
  en: "English",
  ar: "العربية",
};

const SEGMENTS = 24;

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ForestStatus({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`fp-status is-${tone}`}>
      <span className="fp-dot" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

export function ForestMicHeader({ withCamera }: { withCamera: boolean }) {
  const t = useTranslations("forestPrep");
  return (
    <header className="fp-head">
      <div className="fp-head-text">
        <h1 className="fp-title">{withCamera ? t("micTitleBoth") : t("micTitleMic")}</h1>
        <p className="fp-sub">{withCamera ? t("micSubtitleBoth") : t("micSubtitleMic")}</p>
      </div>
      <JourneySteps stage="prepare" className="fp-steps" />
    </header>
  );
}

export function ForestCardHead({ title, body }: { title: string; body: string }) {
  return (
    <div className="fp-card-head">
      <h2 className="fp-card-title">{title}</h2>
      <p className="fp-card-sub">{body}</p>
    </div>
  );
}

export function ForestMicPermission({
  onNotNow,
  onAllow,
}: {
  onNotNow: () => void;
  onAllow: () => void;
}) {
  const t = useTranslations();
  return (
    <div className="fp-mic-perm">
      <span className="fp-mic-perm-icon" aria-hidden="true">
        <MicIcon size={24} />
      </span>
      <h3 className="fp-section-title">{t("micTest.permTitle")}</h3>
      <p className="fp-card-sub">{t("forestPrep.permBody")}</p>
      <div className="fp-btn-row">
        <button type="button" className="btn btn-primary" onClick={onAllow}>
          <MicIcon size={18} /> {t("micTest.allowMic")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={onNotNow}>
          {t("micTest.notNow")}
        </button>
      </div>
    </div>
  );
}

export function ForestMicDenied({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("micTest");
  return (
    <div className="fp-mic-perm">
      <ForestStatus tone="danger">{t("permDeniedTitle")}</ForestStatus>
      <p className="fp-card-sub">{t("permDeniedBody")}</p>
      <div className="fp-btn-row">
        <button type="button" className="btn btn-primary" onClick={onRetry}>
          {t("tryAgain")}
        </button>
      </div>
    </div>
  );
}

export function ForestMicDevice({ label }: { label: string | null }) {
  const t = useTranslations("forestPrep");
  return (
    <div className="fp-device">
      <span className="fp-device-icon" aria-hidden="true">
        <MicIcon size={20} />
      </span>
      <span className="fp-row-text">
        <span className="fp-device-name" dir="auto">
          {label || t("deviceDefault")}
        </span>
        <span className="fp-row-sub">{t("deviceHint")}</span>
      </span>
    </div>
  );
}

export function ForestMicLevel({
  recording,
  recorded,
  silent,
  unsupported,
  level,
  seconds,
  maxSeconds,
}: {
  recording: boolean;
  recorded: boolean;
  silent: boolean;
  unsupported: boolean;
  level: number;
  seconds: number;
  maxSeconds: number;
}) {
  const t = useTranslations();
  const pct = recording ? Math.min(100, Math.round(level * 400)) : 0;
  const lit = Math.round((pct / 100) * SEGMENTS);

  const tone: Tone = recording ? "rec" : recorded ? (silent ? "danger" : "ok") : "ok";
  const status = recording
    ? t("forestPrep.statusRecording")
    : recorded
      ? silent
        ? t("forestPrep.statusSilent")
        : t("forestPrep.statusHeard")
      : t("micTest.micConnected");
  const hint = recording
    ? t("forestPrep.hintRecording")
    : recorded
      ? silent
        ? null
        : t("forestPrep.hintRecorded")
      : unsupported
        ? null
        : t("forestPrep.hintIdle");

  return (
    <div className="fp-level">
      <div className="fp-level-top">
        <ForestStatus tone={tone}>{status}</ForestStatus>
        {recording || recorded ? (
          <span className="fp-timer" dir="ltr">
            {recording
              ? `${clock(seconds)} / ${clock(maxSeconds)}`
              : clock(Math.max(1, seconds))}
          </span>
        ) : null}
      </div>
      <div
        className={recording ? "fp-meter is-live" : "fp-meter"}
        role="meter"
        aria-label={t("micTest.levelLabel")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span key={i} className={i < lit ? "is-on" : undefined} />
        ))}
      </div>
      {hint ? <p className="fp-hint">{hint}</p> : null}
      {recorded && silent ? (
        <div role="status" className="fp-alert">
          {t("micTest.silentRecording")}
        </div>
      ) : null}
      {unsupported ? (
        <p role="status" className="fp-hint">
          {t("micTest.recorderUnsupported")}
        </p>
      ) : null}
    </div>
  );
}

export function ForestMicActions({
  recording,
  recorded,
  playing,
  unsupported,
  onToggleRecording,
  onTogglePlayback,
}: {
  recording: boolean;
  recorded: boolean;
  playing: boolean;
  unsupported: boolean;
  onToggleRecording: () => void;
  onTogglePlayback: () => void;
}) {
  const t = useTranslations();
  if (recorded) {
    return (
      <div className="fp-btn-row">
        <button type="button" className="btn btn-secondary" onClick={onTogglePlayback}>
          {playing ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          {playing ? t("forestPrep.pause") : t("forestPrep.play")}
        </button>
        <button type="button" className="btn btn-ghost fp-btn-text" onClick={onToggleRecording}>
          <RefreshIcon size={18} />
          {t("micTest.recordAgain")}
        </button>
      </div>
    );
  }
  return (
    <div className="fp-btn-row">
      <button
        type="button"
        className={recording ? "btn btn-secondary fp-rec is-on" : "btn btn-secondary fp-rec"}
        onClick={onToggleRecording}
        disabled={unsupported}
      >
        {recording ? <StopIcon size={16} /> : <MicIcon size={18} />}
        {recording ? t("forestPrep.stop") : t("forestPrep.record")}
      </button>
    </div>
  );
}

export function ForestCamStatus({
  cam,
  signal,
}: {
  cam: "idle" | "starting" | "on" | "denied" | "unavailable";
  signal: "unknown" | "ok" | "none";
}) {
  const t = useTranslations();
  const [tone, text]: [Tone, string] =
    cam === "on"
      ? signal === "none"
        ? ["amber", t("micTest.cameraNoSignal")]
        : ["ok", t("micTest.cameraOk")]
      : cam === "denied"
        ? ["danger", t("micTest.cameraDenied")]
        : cam === "unavailable"
          ? ["danger", t("micTest.cameraUnavailable")]
          : cam === "starting"
            ? ["idle", t("forestPrep.camStarting")]
            : ["idle", t("forestPrep.camOff")];
  return (
    <div className="fp-cam-status">
      <ForestStatus tone={tone}>{text}</ForestStatus>
    </div>
  );
}

export function ForestCamPlaceholder({
  children,
}: {
  children?: ReactNode;
}) {
  return (
    <div className="fp-cam-placeholder">
      <CameraIcon size={30} aria-hidden="true" />
      {children}
    </div>
  );
}

/** The camera column before the microphone is allowed (the check opens after). */
export function ForestCamWaiting() {
  const t = useTranslations();
  return (
    <div className="card fp-card fp-cam-card">
      <ForestCardHead title={t("forestPrep.camCardTitle")} body={t("forestPrep.camCardBody")} />
      <ForestCamPlaceholder>
        <span className="fp-cam-placeholder-text">{t("forestPrep.camWaiting")}</span>
      </ForestCamPlaceholder>
      <ForestCamStatus cam="idle" signal="unknown" />
    </div>
  );
}

export function ForestMicFooter({
  backHref,
  canStart,
  need,
  onStart,
}: {
  backHref: string;
  canStart: boolean;
  need: "mic" | "recording" | "camera" | null;
  onStart: () => void;
}) {
  const t = useTranslations("forestPrep");
  const note =
    need === "mic"
      ? t("needMic")
      : need === "recording"
        ? t("needRecording")
        : need === "camera"
          ? t("needCamera")
          : t("readyAll");
  return (
    <div className="card fp-actionbar">
      <p className="fp-actionbar-note" role="status">
        <ForestStatus tone={need ? "amber" : "ok"}>{note}</ForestStatus>
      </p>
      <div className="fp-actionbar-btns">
        <Link href={backHref} className="btn btn-secondary">
          {t("back")}
        </Link>
        <button type="button" className="btn btn-primary" disabled={!canStart} onClick={onStart}>
          {t("enter")}
          <span className="icon-flip">
            <ArrowIcon size={18} />
          </span>
        </button>
      </div>
    </div>
  );
}

export type ReadyState = "done" | "pending" | "warn";

/**
 * What is checked so far (from the live recorder / camera state) and what the
 * conversation will be (from the interview plan). Nothing here is assumed.
 */
export function ForestReadyCard({
  mic,
  test,
  camera,
  questionCount,
  minutes,
  language,
}: {
  mic: ReadyState;
  test: ReadyState;
  camera: { state: ReadyState; optional: boolean; exemptLabel: string | null } | null;
  questionCount: number;
  minutes: number;
  language: InterviewLanguage | null;
}) {
  const t = useTranslations("forestPrep");
  const rows: { key: string; label: string; state: ReadyState }[] = [
    { key: "mic", label: t("readyMic"), state: mic },
    { key: "test", label: t("readyTest"), state: test },
  ];
  if (camera) {
    rows.push({
      key: "cam",
      label: camera.exemptLabel ?? (camera.optional ? t("readyCamOptional") : t("readyCam")),
      state: camera.state,
    });
  }
  return (
    <div className="card fp-card fp-ready-card">
      <h2 className="fp-card-title">{t("readyTitle")}</h2>
      <ul className="fp-checks fp-ready-list">
        {rows.map((row) => (
          <li
            key={row.key}
            className={`fp-check ${row.state === "done" ? "is-ready" : row.state === "warn" ? "is-warn" : "is-pending"}`}
          >
            <span className="fp-check-mark" aria-hidden="true">
              {row.state === "done" ? <CheckIcon size={13} /> : null}
            </span>
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
      {questionCount > 0 || minutes > 0 || language ? (
        <div className="fp-meta">
          {questionCount > 0 ? (
            <span className="fp-meta-item">
              <ListIcon size={20} />
              {t("questionsCount", { count: questionCount })}
            </span>
          ) : null}
          {minutes > 0 ? (
            <span className="fp-meta-item">
              <ClockIcon size={19} />
              {t("minutesApprox", { minutes })}
            </span>
          ) : null}
          {language ? (
            <span className="fp-meta-item">
              <GlobeIcon size={19} />
              {t("languageIs", { language: LANGUAGE_NAMES[language] })}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
