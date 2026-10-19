"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Link, useRouter } from "@/lib/i18n/navigation";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { GlowOrb } from "@/components/podtask/glow-orb";
import { ArrowIcon, BackIcon, ChevronIcon, SparkIcon } from "@/components/podtask/icons";
import { recordConsent } from "@/lib/student/student-service";
import type { CameraMode } from "@/lib/integrity/settings";
import { useTheme } from "@/components/providers/theme-provider";
import { ForestConsent } from "./forest-consent";

interface ConsentClientProps {
  submissionId: string;
  interviewId: string;
  locale: string;
  version: string;
  camera: CameraMode;
  activityMonitoring: boolean;
  overlapCheck: boolean;
  hostName: string;
}

export function ConsentClient({
  submissionId,
  interviewId,
  locale,
  version,
  camera,
  activityMonitoring,
  overlapCheck,
}: ConsentClientProps) {
  const t = useTranslations();
  const router = useRouter();
  const { theme } = useTheme();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const cameraOn = camera !== "off";
  const paragraph2 = cameraOn
    ? t("consent.p2Camera")
    : activityMonitoring
      ? t("consent.p2Activity")
      : t("consent.p2Minimal");

  async function accept() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const ok = interviewId ? await recordConsent(interviewId, version, locale) : true;
      if (!ok) {
        setError(t("consent.error"));
        setPending(false);
        return;
      }
      router.push(`/student/submissions/${submissionId}/mic-test`);
    } catch {
      setError(t("consent.error"));
      setPending(false);
    }
  }

  if (theme === "forest") {
    return (
      <ForestConsent
        submissionId={submissionId}
        version={version}
        cameraOn={cameraOn}
        activityMonitoring={activityMonitoring}
        overlapCheck={overlapCheck}
        paragraph2={paragraph2}
        open={open}
        onToggleOpen={() => setOpen((o) => !o)}
        pending={pending}
        error={error}
        onAccept={() => void accept()}
      />
    );
  }

  return (
    <div className="page-narrow">
      <Link
        href={`/student/submissions/${submissionId}/lobby`}
        className="btn btn-ghost row"
        style={{ padding: "8px 0", gap: 8 }}
      >
        <span className="icon-flip">
          <BackIcon />
        </span>
        {t("micTest.back")}
      </Link>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="card-hero consent-card"
        style={{ padding: 40, marginTop: 24 }}
      >
        <div className="row" style={{ gap: 18, alignItems: "center" }}>
          <GlowOrb size={64} state="listening" float />
          <div>
            <Eyebrow icon={<SparkIcon size={14} />}>{t("consent.eyebrow")}</Eyebrow>
            <h1 className="title" style={{ margin: "6px 0 0", fontSize: 30 }}>
              {t("consent.title")}
            </h1>
          </div>
        </div>

        <div className="consent-text" style={{ marginTop: 24 }}>
          <p>{t("consent.p1")}</p>
          <p>{paragraph2}</p>
          <p>{t("consent.p3")}</p>
        </div>

        {/* Exam-integrity notice: what is monitored, what cannot be seen, what is stored. */}
        {cameraOn || activityMonitoring ? (
          <div className="consent-notice" role="note">
            <div className="consent-notice-title">{t("consent.monitorTitle")}</div>
            <p className="consent-notice-body">
              {cameraOn && activityMonitoring
                ? t("consent.monitorBodyBoth")
                : cameraOn
                  ? t("consent.monitorBodyCamera")
                  : t("consent.monitorBodyTabs")}
            </p>
            <div className="consent-notice-grid">
              <div>
                <h4>{t("consent.cannotTitle")}</h4>
                <ul className="consent-list">
                  {activityMonitoring ? <li>{t("consent.cannotTabs")}</li> : null}
                  {cameraOn ? <li>{t("consent.cannotCamera")}</li> : null}
                  <li>{t("consent.cannotProof")}</li>
                </ul>
              </div>
              <div>
                <h4>{t("consent.storedTitle")}</h4>
                <ul className="consent-list">
                  {activityMonitoring ? <li>{t("consent.storedTabs")}</li> : null}
                  {cameraOn ? <li>{t("consent.storedCamera")}</li> : null}
                  <li>{t("consent.storedNoVideo")}</li>
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        <div
          className="card"
          style={{
            marginTop: 8,
            padding: 0,
            borderRadius: 20,
            boxShadow: "none",
            background: "rgba(240,249,255,0.6)",
            overflow: "hidden",
          }}
        >
          <button
            type="button"
            className="between"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            style={{
              width: "100%",
              padding: "16px 20px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              font: "inherit",
              color: "inherit",
              textAlign: "start",
            }}
          >
            <span style={{ fontWeight: 800, fontSize: 15 }}>{t("consent.disclosureTitle")}</span>
            <span
              style={{
                display: "inline-flex",
                transition: "transform .2s",
                transform: open ? "rotate(180deg)" : "none",
              }}
            >
              <ChevronIcon size={16} />
            </span>
          </button>
          {open ? (
            <div style={{ padding: "0 20px 20px" }}>
              <div style={{ fontWeight: 800, fontSize: 13, marginTop: 4 }}>
                {t("consent.collectedTitle")}
              </div>
              <ul className="consent-list">
                <li>{t("consent.collectedAudio")}</li>
                <li>{t("consent.collectedTiming")}</li>
                {activityMonitoring ? <li>{t("consent.collectedActivity")}</li> : null}
                {cameraOn ? <li>{t("consent.collectedCamera")}</li> : null}
                {overlapCheck ? <li>{t("consent.collectedDocument")}</li> : null}
              </ul>
              <div style={{ fontWeight: 800, fontSize: 13, marginTop: 16 }}>
                {t("consent.accessTitle")}
              </div>
              <p className="text-muted" style={{ fontSize: 14, lineHeight: 1.6, margin: "6px 0 0" }}>
                {t("consent.accessBody")}
              </p>
              <div style={{ fontWeight: 800, fontSize: 13, marginTop: 16 }}>
                {t("consent.retentionTitle")}
              </div>
              <p className="text-muted" style={{ fontSize: 14, lineHeight: 1.6, margin: "6px 0 0" }}>
                {t("consent.retentionBody")}
              </p>
              <p style={{ fontSize: 14, lineHeight: 1.6, margin: "14px 0 0", fontWeight: 600 }}>
                {t("consent.noAutoVerdict")}
              </p>
              <p className="text-muted" style={{ fontSize: 12, lineHeight: 1.6, margin: "12px 0 0" }}>
                {t("consent.legalNote")}{" "}
                <Link href="/student/help" style={{ color: "rgb(var(--cyan))", fontWeight: 700 }}>
                  {t("consent.privacyLink")}
                </Link>
              </p>
            </div>
          ) : null}
        </div>

        {error ? (
          <div
            role="alert"
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 12,
              background: "rgba(255,241,245,0.7)",
              color: "rgb(var(--pink-rose))",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        ) : null}

        <button
          type="button"
          className="btn btn-primary btn-lg"
          style={{ width: "100%", marginTop: 24 }}
          onClick={() => void accept()}
          disabled={pending}
        >
          {pending ? t("consent.saving") : t("consent.cta")}
          <span className="icon-flip">
            <ArrowIcon />
          </span>
        </button>
        <div className="text-muted" style={{ fontSize: 12, textAlign: "center", marginTop: 12 }}>
          {t("consent.versionNote", { version })}
        </div>
      </motion.div>
    </div>
  );
}
