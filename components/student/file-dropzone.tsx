"use client";

import { useCallback, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Chip } from "@/components/podtask/chip";
import { DocIcon, UploadIcon, XIcon } from "@/components/podtask/icons";
import { cn, formatBytes } from "@/lib/utils";

const MAX_BYTES = 25 * 1024 * 1024;
const ALLOWED = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "text/plain",
];

export interface SelectedFile {
  name: string;
  size: number;
  type: string;
  file: File;
}

interface FileDropzoneProps {
  onFile: (file: SelectedFile | null) => void;
  selected: SelectedFile | null;
  progress: number;
  uploading: boolean;
}

export function FileDropzone({
  onFile,
  selected,
  progress,
  uploading,
}: FileDropzoneProps) {
  const t = useTranslations();
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      setError(null);
      if (file.size > MAX_BYTES) {
        setError(t("upload.errorTooLarge"));
        return;
      }
      const isAllowed =
        ALLOWED.includes(file.type) ||
        /\.(pdf|docx|doc|txt)$/i.test(file.name);
      if (!isAllowed) {
        setError(t("upload.errorUnsupported"));
        return;
      }
      onFile({ name: file.name, size: file.size, type: file.type, file });
    },
    [onFile, t],
  );

  if (selected) {
    const done = progress >= 100;
    const ext = /\.([a-z0-9]{1,4})$/i.exec(selected.name)?.[1]?.toUpperCase();
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
        style={{ padding: 24, marginTop: 32 }}
        role="status"
        aria-live="polite"
      >
        <div className="row" style={{ gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: "rgb(var(--white))",
              border: "1px solid rgb(var(--line))",
              boxShadow: "0 1px 2px rgba(16,24,40,0.06)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
              color: "rgb(var(--ink-2))",
              flexShrink: 0,
            }}
          >
            <DocIcon size={22} />
            {ext && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  lineHeight: 1,
                  color: "rgb(var(--muted))",
                }}
              >
                {ext}
              </span>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{ fontWeight: 800, fontSize: 16, overflowWrap: "anywhere" }}
            >
              <bdi>{selected.name}</bdi>
            </div>
            <div
              className="text-muted"
              style={{ fontSize: 13, marginTop: 2 }}
            >
              {done ? (
                <>
                  <bdi>{formatBytes(selected.size)}</bdi> ·{" "}
                  <span style={{ color: "rgb(var(--ink))", fontWeight: 600 }}>
                    {t("upload.ready")}
                  </span>
                </>
              ) : (
                t("upload.uploadingPercent", { percent: progress })
              )}
            </div>
          </div>
          <UploadRing progress={progress} label={t("status.uploading")} />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={uploading}
            onClick={() => onFile(null)}
            aria-label={t("common.cancel")}
          >
            <XIcon />
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <>
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn("dropzone", drag && "drag")}
        style={{ marginTop: 32, cursor: "pointer" }}
        role="button"
        tabIndex={0}
        aria-label={`${t("upload.dropHere")}, ${t("upload.orClick")}`}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          handleFile(e.dataTransfer.files[0]);
        }}
      >
        <div style={{ position: "relative", display: "inline-block" }}>
          <div
            style={{
              width: 96,
              height: 96,
              borderRadius: "50%",
              background:
                "linear-gradient(135deg, rgba(125,211,252,0.3), rgba(253,164,175,0.3))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto",
              boxShadow:
                "0 10px 30px rgba(14,165,233,0.18), inset 0 2px 0 rgba(255,255,255,0.6)",
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "white",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "rgb(var(--cyan))",
              }}
            >
              <UploadIcon size={28} />
            </div>
          </div>
        </div>
        <div
          style={{
            fontSize: 20,
            fontWeight: 800,
            marginTop: 20,
            letterSpacing: "-0.01em",
          }}
        >
          {t("upload.dropHere")}
        </div>
        <div className="text-muted" style={{ fontSize: 14, marginTop: 8 }}>
          {t("upload.orClick")}
        </div>
        <div
          className="row"
          style={{ gap: 12, marginTop: 24, justifyContent: "center", flexWrap: "wrap" }}
        >
          <Chip>PDF</Chip>
          <Chip>DOCX</Chip>
          <Chip>TXT</Chip>
          <Chip>{t("upload.maxSize")}</Chip>
        </div>
        <input
          ref={inputRef}
          type="file"
          hidden
          accept=".pdf,.doc,.docx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
      </motion.div>

      <AnimatePresence>
        {error && (
          <motion.div
            role="alert"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="card"
            style={{
              marginTop: 20,
              padding: 18,
              background: "rgba(255,241,245,0.7)",
              boxShadow: "none",
              borderRadius: 18,
              color: "rgb(var(--pink-deep))",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

const RING_R = 13;
const RING_C = 2 * Math.PI * RING_R;

/** Progress ring that fills while uploading, then closes into a solid check seal. */
function UploadRing({ progress, label }: { progress: number; label: string }) {
  const done = progress >= 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress}
      aria-label={label}
      style={{ position: "relative", width: 32, height: 32, flexShrink: 0 }}
    >
      <svg
        width={32}
        height={32}
        viewBox="0 0 32 32"
        aria-hidden
        style={{ transform: "rotate(-90deg)" }}
      >
        <circle
          cx={16}
          cy={16}
          r={RING_R}
          fill="none"
          stroke="rgb(var(--line))"
          strokeWidth={2.5}
        />
        <circle
          cx={16}
          cy={16}
          r={RING_R}
          fill="none"
          stroke="rgb(var(--ink))"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={RING_C}
          strokeDashoffset={RING_C * (1 - Math.min(progress, 100) / 100)}
          style={{ transition: "stroke-dashoffset .15s" }}
        />
      </svg>
      <AnimatePresence>
        {done && (
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 520, damping: 26 }}
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: "rgb(var(--ink))",
              color: "rgb(var(--white))",
              display: "grid",
              placeItems: "center",
              boxShadow: "0 6px 16px rgba(16,24,40,0.22)",
            }}
          >
            <svg
              width={15}
              height={15}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <motion.path
                d="M20 6 9 17l-5-5"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.28, delay: 0.08, ease: "easeOut" }}
              />
            </svg>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
