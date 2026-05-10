"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { useRouter, Link } from "@/lib/i18n/navigation";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { FileDropzone, type SelectedFile } from "@/components/student/file-dropzone";
import { Steps } from "@/components/podtask/steps";
import { Eyebrow } from "@/components/podtask/eyebrow";
import {
  ArrowIcon,
  BackIcon,
  SparkIcon,
} from "@/components/podtask/icons";
import { uploadAssignmentFile } from "@/lib/student/student-service";
import type { StudentAssignment } from "@/lib/student/types";

interface UploadAssignmentClientProps {
  assignment: StudentAssignment;
}

export function UploadAssignmentClient({ assignment }: UploadAssignmentClientProps) {
  const t = useTranslations();
  const router = useRouter();
  const [selected, setSelected] = useState<SelectedFile | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  const stepLabels = [
    t("details.stepUpload"),
    t("details.stepAnalyze"),
    t("details.stepInterview"),
    t("details.stepFinish"),
  ];

  async function handleFileSelected(file: SelectedFile | null) {
    setSelected(file);
    setProgress(0);
    if (!file) return;

    setUploading(true);
    try {
      const { submission } = await uploadAssignmentFile(
        assignment.id,
        file.file,
        (p) => setProgress(p),
      );
      setProgress(100);
      // Auto-advance happens on Continue button.
      // Persist for navigation.
      sessionStorage.setItem(`submission:${assignment.id}`, submission.id);
    } finally {
      setUploading(false);
    }
  }

  function handleContinue() {
    const submissionId = sessionStorage.getItem(`submission:${assignment.id}`);
    if (submissionId) {
      router.push(`/student/submissions/${submissionId}/processing`);
    }
  }

  const continueDisabled = !selected || progress < 100;

  return (
    <StudentAppShell>
      <div className="page-narrow">
        <Link
          href={`/student/assignments/${assignment.id}`}
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
            {t("common.back")}
          </button>
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
          <Eyebrow showDot>{t("upload.stepLabel")}</Eyebrow>
          <h1 className="display" style={{ fontSize: 40 }}>
            {t("upload.title")}
          </h1>
          <p className="subtitle">{t("upload.subtitle")}</p>
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
                {t("upload.draftEnoughTitle")}
              </strong>{" "}
              {t("upload.draftEnoughBody")}
            </div>
          </div>
        </div>

        <div
          className="row"
          style={{ gap: 12, marginTop: 32, justifyContent: "flex-end" }}
        >
          <Link
            href={`/student/assignments/${assignment.id}`}
            style={{ textDecoration: "none" }}
          >
            <button type="button" className="btn btn-secondary btn-lg">
              {t("upload.saveExit")}
            </button>
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
