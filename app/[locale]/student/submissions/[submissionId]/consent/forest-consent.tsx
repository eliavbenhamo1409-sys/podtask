"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { JourneySteps } from "@/components/student/journey-steps";
import {
  ArrowIcon,
  BulbIcon,
  CheckIcon,
  ChevronIcon,
  MessageIcon,
  ShieldIcon,
} from "@/components/podtask/icons";

interface ForestConsentProps {
  submissionId: string;
  version: string;
  cameraOn: boolean;
  activityMonitoring: boolean;
  overlapCheck: boolean;
  /** consent.p2Camera / p2Activity / p2Minimal, already resolved. */
  paragraph2: string;
  open: boolean;
  onToggleOpen: () => void;
  pending: boolean;
  error: string | null;
  onAccept: () => void;
}

/**
 * Forest skin of the integrity notice. Same content and the same accept
 * handler as the classic card; the student ticks an explicit
 * acknowledgement before the confirm button turns on.
 */
export function ForestConsent({
  submissionId,
  version,
  cameraOn,
  activityMonitoring,
  overlapCheck,
  paragraph2,
  open,
  onToggleOpen,
  pending,
  error,
  onAccept,
}: ForestConsentProps) {
  const t = useTranslations();
  const [acknowledged, setAcknowledged] = useState(false);
  const monitored = cameraOn || activityMonitoring;

  const how = [
    { icon: <MessageIcon size={22} />, title: t("forestPrep.howOwnTitle"), body: t("consent.p1") },
    { icon: <ShieldIcon size={22} />, title: t("forestPrep.howFairTitle"), body: paragraph2 },
    { icon: <BulbIcon size={22} />, title: t("forestPrep.howThinkTitle"), body: t("consent.p3") },
  ];

  const disclosure = (
    <section className={monitored ? "card fp-card fp-disclosure is-wide" : "card fp-card fp-disclosure"}>
      <button
        type="button"
        className="fp-disclosure-btn"
        onClick={onToggleOpen}
        aria-expanded={open}
      >
        <span>{t("consent.disclosureTitle")}</span>
        <span className={open ? "fp-chevron is-open" : "fp-chevron"}>
          <ChevronIcon size={18} />
        </span>
      </button>
      {open ? (
        <div className="fp-disclosure-body">
          <div>
            <h3 className="fp-mini-title">{t("consent.collectedTitle")}</h3>
            <ul className="fp-dots">
              <li>{t("consent.collectedAudio")}</li>
              <li>{t("consent.collectedTiming")}</li>
              {activityMonitoring ? <li>{t("consent.collectedActivity")}</li> : null}
              {cameraOn ? <li>{t("consent.collectedCamera")}</li> : null}
              {overlapCheck ? <li>{t("consent.collectedDocument")}</li> : null}
            </ul>
          </div>
          <div>
            <h3 className="fp-mini-title">{t("consent.accessTitle")}</h3>
            <p className="fp-body">{t("consent.accessBody")}</p>
            <h3 className="fp-mini-title">{t("consent.retentionTitle")}</h3>
            <p className="fp-body">{t("consent.retentionBody")}</p>
          </div>
          <div>
            <p className="fp-body fp-body-strong">{t("consent.noAutoVerdict")}</p>
            <p className="fp-fine">
              {t("consent.legalNote")}{" "}
              <Link href="/student/help" className="fp-link">
                {t("consent.privacyLink")}
              </Link>
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );

  return (
    <div className="page fp-page fp-consent">
      <header className="fp-head">
        <div className="fp-head-text">
          <h1 className="fp-title">{t("forestPrep.consentTitle")}</h1>
          <p className="fp-sub">{t("forestPrep.consentSubtitle")}</p>
        </div>
        <JourneySteps stage="prepare" className="fp-steps" />
      </header>

      <div className="fp-grid">
        <section className="card fp-card" aria-labelledby="fp-how-title">
          <h2 className="fp-card-title" id="fp-how-title">
            {t("forestPrep.howTitle")}
          </h2>
          <ul className="fp-list fp-list-roomy">
            {how.map((row) => (
              <li key={row.title} className="fp-list-row">
                <span className="fp-row-icon">{row.icon}</span>
                <span className="fp-row-text">
                  <span className="fp-list-title">{row.title}</span>
                  <span className="fp-row-sub">{row.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {monitored ? (
          <section className="card fp-card" role="note" aria-labelledby="fp-monitor-title">
            <h2 className="fp-card-title" id="fp-monitor-title">
              {t("consent.monitorTitle")}
            </h2>
            <p className="fp-card-sub">
              {cameraOn && activityMonitoring
                ? t("consent.monitorBodyBoth")
                : cameraOn
                  ? t("consent.monitorBodyCamera")
                  : t("consent.monitorBodyTabs")}
            </p>
            <div className="fp-notice-grid">
              <div>
                <h3 className="fp-mini-title">{t("consent.cannotTitle")}</h3>
                <ul className="fp-dots">
                  {activityMonitoring ? <li>{t("consent.cannotTabs")}</li> : null}
                  {cameraOn ? <li>{t("consent.cannotCamera")}</li> : null}
                  <li>{t("consent.cannotProof")}</li>
                </ul>
              </div>
              <div>
                <h3 className="fp-mini-title">{t("consent.storedTitle")}</h3>
                <ul className="fp-dots">
                  {activityMonitoring ? <li>{t("consent.storedTabs")}</li> : null}
                  {cameraOn ? <li>{t("consent.storedCamera")}</li> : null}
                  <li>{t("consent.storedNoVideo")}</li>
                </ul>
              </div>
            </div>
          </section>
        ) : (
          disclosure
        )}
      </div>

      {monitored ? disclosure : null}

      {error ? (
        <div role="alert" className="fp-alert">
          {error}
        </div>
      ) : null}

      <div className="card fp-actionbar">
        <label className="fp-ack">
          <input
            type="checkbox"
            className="fp-ack-input"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
          />
          <span className="fp-ack-box" aria-hidden="true">
            <CheckIcon size={16} />
          </span>
          <span className="fp-row-text">
            <span className="fp-ack-text">
              {monitored ? t("forestPrep.ackMonitored") : t("forestPrep.ackPlain")}
            </span>
            <span className="fp-ack-note">{t("forestPrep.ackNote", { version })}</span>
          </span>
        </label>
        <div className="fp-actionbar-btns">
          <Link href={`/student/submissions/${submissionId}/lobby`} className="btn btn-secondary">
            {t("forestPrep.back")}
          </Link>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onAccept}
            disabled={pending || !acknowledged}
          >
            {pending ? t("consent.saving") : t("forestPrep.confirm")}
            <span className="icon-flip">
              <ArrowIcon size={18} />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
