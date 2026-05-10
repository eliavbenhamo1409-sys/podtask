"use client";

import { motion } from "framer-motion";
import { useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { Chip } from "@/components/podtask/chip";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { GlowOrb } from "@/components/podtask/glow-orb";
import { Waveform } from "@/components/podtask/waveform";
import {
  ArrowIcon,
  MicIcon,
  SparkIcon,
  UploadIcon,
} from "@/components/podtask/icons";

export function SelfInitiatedHero() {
  const t = useTranslations();

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay: 0.05 }}
      className="card-hero"
      style={{ padding: 40, position: "relative", marginTop: 40 }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 360px",
          gap: 40,
          alignItems: "center",
        }}
      >
        <div>
          <Eyebrow icon={<SparkIcon size={14} />}>
            {t("self.eyebrow")}
          </Eyebrow>
          <h2 className="title" style={{ fontSize: 34, marginTop: 8 }}>
            {t("self.title")}
          </h2>
          <p className="subtitle" style={{ marginTop: 12, maxWidth: 520 }}>
            {t("self.subtitle")}
          </p>

          <ul
            className="text-muted"
            style={{
              listStyle: "none",
              padding: 0,
              marginTop: 20,
              display: "grid",
              gap: 10,
              fontSize: 14,
              fontWeight: 600,
              maxWidth: 520,
            }}
          >
            <li className="row" style={{ gap: 10 }}>
              <span style={{ color: "rgb(var(--cyan))" }}>
                <UploadIcon size={16} />
              </span>
              {t("self.step1")}
            </li>
            <li className="row" style={{ gap: 10 }}>
              <span style={{ color: "rgb(var(--cyan))" }}>
                <SparkIcon size={16} />
              </span>
              {t("self.step2")}
            </li>
            <li className="row" style={{ gap: 10 }}>
              <span style={{ color: "rgb(var(--cyan))" }}>
                <MicIcon size={16} />
              </span>
              {t("self.step3")}
            </li>
          </ul>

          <div className="row" style={{ gap: 12, marginTop: 28 }}>
            <Link href="/student/self/new" style={{ textDecoration: "none" }}>
              <button type="button" className="btn btn-primary btn-lg">
                <UploadIcon size={18} />
                {t("self.cta")}
                <span className="icon-flip">
                  <ArrowIcon />
                </span>
              </button>
            </Link>
            <Link
              href="/student/history"
              style={{ textDecoration: "none" }}
            >
              <button type="button" className="btn btn-secondary btn-lg">
                {t("self.viewPast")}
              </button>
            </Link>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            height: 280,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "radial-gradient(circle at 50% 50%, rgba(125,211,252,0.18), transparent 70%)",
              borderRadius: "50%",
            }}
          />
          <GlowOrb
            size={200}
            float
            style={{ animation: "spin 14s linear infinite, float 4s ease-in-out infinite" }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 6,
              insetInlineStart: 0,
              insetInlineEnd: 0,
              textAlign: "center",
            }}
          >
            <Chip variant="cyan" className="text-[11px]">
              <Waveform />
              {t("self.hostHint")}
            </Chip>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
