"use client";

import { useCallback, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { Badge, Chip } from "@/components/podtask/chip";
import {
  CheckIcon,
  DocIcon,
  UploadIcon,
  XIcon,
} from "@/components/podtask/icons";
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
    return (
      <motion.div
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="card"
        style={{ padding: 28, marginTop: 32 }}
        role="status"
        aria-live="polite"
      >
        <div className="row" style={{ gap: 16 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background:
                "linear-gradient(135deg, rgba(125,211,252,0.25), rgba(253,164,175,0.25))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgb(var(--cyan))",
              flexShrink: 0,
            }}
          >
            <DocIcon size={26} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="between" style={{ gap: 12, flexWrap: "wrap" }}>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{ fontWeight: 800, fontSize: 16, overflowWrap: "anywhere" }}
                >
                  <bdi>{selected.name}</bdi>
                </div>
                <div
                  className="text-muted"
                  style={{ fontSize: 13, marginTop: 2 }}
                >
                  {progress < 100
                    ? t("upload.uploadingPercent", { percent: progress })
                    : `${formatBytes(selected.size)} · ${t("upload.ready")}`}
                </div>
              </div>
              {progress >= 100 ? (
                <Badge variant="mint">
                  <CheckIcon size={12} />
                  {t("upload.ready")}
                </Badge>
              ) : (
                <Badge variant="cyan" showDot>
                  {t("status.uploading")}
                </Badge>
              )}
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              aria-label={t("status.uploading")}
              style={{
                marginTop: 14,
                height: 6,
                background: "rgb(var(--line-2))",
                borderRadius: 99,
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: "linear-gradient(90deg, #7DD3FC, #0EA5E9)",
                  borderRadius: 99,
                  transition: "width .15s",
                }}
              />
            </div>
          </div>
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
