"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { useRouter, Link } from "@/lib/i18n/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import {
  FileDropzone,
  type SelectedFile,
} from "@/components/student/file-dropzone";
import { Steps } from "@/components/podtask/steps";
import { Eyebrow } from "@/components/podtask/eyebrow";
import {
  ArrowIcon,
  BackIcon,
  SparkIcon,
} from "@/components/podtask/icons";
import { uploadSelfInitiatedFile } from "@/lib/student/student-service";

export function SelfInitiatedUploadClient() {
  const t = useTranslations();
  const router = useRouter();
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null>(null);

  const stepLabels = [
    t("details.stepUpload"),
    t("details.stepAnalyze"),
    t("details.stepInterview"),
    t("details.stepFinish"),
  ];

  async function handleFileSelected(file: SelectedFile | null) {
    setSelected(file);
    setProgress(0);
    setSubmissionId(null);
    if (!file) return;

    setUploading(true);
    try {
      const result = await uploadSelfInitiatedFile(file.file, (p) =>
        setProgress(p),
      );
      setProgress(100);
      setSubmissionId(result.submission.id);
    } finally {
      setUploading(false);
    }
  }

  function handleContinue() {
    if (!submissionId) return;
    router.push(`/student/submissions/${submissionId}/processing`);
  }

  const continueDisabled = !selected || progress < 100 || !submissionId;

  return (
    <StudentAppShell>
      <div className="page-narrow">
        <Link href="/student" className="btn btn-ghost row" style={{ padding: "8px 0", gap: 8 }}>
            <span className="icon-flip">
              <BackIcon />
            </span>
            {t("common.back")}
          </Link>

        <div style={{ marginTop: 16 }}>
          <Steps current={0} items={stepLabels} />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          style={{ marginTop: 40 }}
        >
          <Eyebrow icon={<SparkIcon size={14} />} showDot>
            {t("self.upload.eyebrow")}
          </Eyebrow>
          <h1 className="display">
            {t("self.upload.title")}
          </h1>
          <p className="subtitle">{t("self.upload.subtitle")}</p>
        </motion.div>

        <FileDropzone
          onFile={handleFileSelected}
          selected={selected}
          progress={progress}
          uploading={uploading}
        />

        <div
          className="card"
          style={{
            marginTop: 24,
            padding: 24,
            boxShadow: "none",
            background: "rgba(246,251,255,0.6)",
            borderRadius: 24,
          }}
        >
          <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
            <div style={{ color: "rgb(var(--cyan))", marginTop: 2 }}>
              <SparkIcon size={18} />
            </div>
            <div
              className="text-muted"
              style={{ fontSize: 13, lineHeight: 1.6 }}
            >
              <strong style={{ color: "rgb(var(--ink))" }}>
                {t("self.upload.tipTitle")}
              </strong>{" "}
              {t("self.upload.tipBody")}
            </div>
          </div>
        </div>

        <div className="stack-actions" style={{ marginTop: 32 }}>
          <Link href="/student" className="btn btn-secondary btn-lg">
              {t("upload.saveExit")}
            </Link>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            disabled={continueDisabled}
            onClick={handleContinue}
          >
            {t("common.continue")}
            <span className="icon-flip">
              <ArrowIcon />
            </span>
          </button>
        </div>
      </div>
    </StudentAppShell>
  );
}
