"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n/navigation";
import { createAssignment } from "@/lib/lecturer/lecturer-service";
import type { CameraMode } from "@/lib/integrity/settings";

interface NewAssignmentFormProps {
  courseId: string;
  courseName: string;
}

/**
 * Opens an assignment for the students of one course. The integrity flags
 * are per assignment so an institution (or one lecturer) can switch any of
 * them off; the defaults are the ones the rest of the product assumes.
 */
export function NewAssignmentForm({ courseId, courseName }: NewAssignmentFormProps) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [language, setLanguage] = useState<"he" | "en">("he");
  const [dueAt, setDueAt] = useState("");
  const [duration, setDuration] = useState(12);
  const [publish, setPublish] = useState(true);
  const [camera, setCamera] = useState<CameraMode>("on");
  const [activity, setActivity] = useState(true);
  const [nudge, setNudge] = useState(20);
  const [overlap, setOverlap] = useState(true);
  const [hostFlags, setHostFlags] = useState(true);
  const [perAnswer, setPerAnswer] = useState(true);
  const [consent, setConsent] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await createAssignment({
      courseId,
      title: title.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
      language,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      interviewDurationMinutes: Math.max(5, Math.min(30, duration)),
      publish,
      integrity: {
        camera,
        activity_monitoring: activity,
        silence_nudge_seconds: nudge,
        overlap_check: overlap,
        host_flags: hostFlags,
        per_answer_evaluation: perAnswer,
        require_consent: consent,
      },
    });
    setPending(false);
    if (!result.ok) {
      setError(t("lecturer.errorGeneric"));
      return;
    }
    setOpen(false);
    router.refresh();
    if (result.assignmentId !== "mock-assignment") {
      router.push(`/lecturer/assignments/${result.assignmentId}`);
    }
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {t("lecturer.newAssignment")}
      </button>
    );
  }

  const toggle = (
    label: string,
    checked: boolean,
    onChange: (v: boolean) => void,
  ) => (
    <label className="lx-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );

  return (
    <form onSubmit={submit} className="card" style={{ padding: 24, borderRadius: 20, flex: "1 1 100%" }}>
      <div style={{ fontWeight: 800, fontSize: 16 }}>
        {t("lecturer.newAssignmentFor", { course: courseName })}
      </div>
      <div className="lx-form-grid" style={{ marginTop: 14 }}>
        <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
          <span>{t("lecturer.assignmentTitle")}</span>
          <input className="input" required value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
          <span>{t("lecturer.description")}</span>
          <textarea className="input lx-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        <label className="lx-field" style={{ gridColumn: "1 / -1" }}>
          <span>{t("lecturer.instructions")}</span>
          <textarea className="input lx-textarea" value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </label>
        <label className="lx-field">
          <span>{t("lecturer.language")}</span>
          <select className="input" value={language} onChange={(e) => setLanguage(e.target.value === "en" ? "en" : "he")}>
            <option value="he">עברית</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="lx-field">
          <span>{t("lecturer.dueAt")}</span>
          <input className="input" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        </label>
        <label className="lx-field">
          <span>{t("lecturer.duration")}</span>
          <input
            className="input"
            type="number"
            min={5}
            max={30}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value) || 12)}
          />
        </label>
        <label className="lx-field">
          <span>{t("lecturer.camera")}</span>
          <select className="input" value={camera} onChange={(e) => setCamera(e.target.value as CameraMode)}>
            <option value="off">{t("lecturer.cameraOff")}</option>
            <option value="on">{t("lecturer.cameraOn")}</option>
            <option value="required">{t("lecturer.cameraRequired")}</option>
          </select>
        </label>
        <label className="lx-field">
          <span>{t("lecturer.silenceNudge")}</span>
          <input
            className="input"
            type="number"
            min={0}
            max={120}
            value={nudge}
            onChange={(e) => setNudge(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
      </div>

      <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgb(var(--muted))", marginTop: 18 }}>
        {t("lecturer.integrityTitle")}
      </div>
      <div className="lx-form-grid" style={{ marginTop: 10 }}>
        {toggle(t("lecturer.activityMonitoring"), activity, setActivity)}
        {toggle(t("lecturer.overlapCheck"), overlap, setOverlap)}
        {toggle(t("lecturer.hostFlags"), hostFlags, setHostFlags)}
        {toggle(t("lecturer.perAnswerEvaluation"), perAnswer, setPerAnswer)}
        {toggle(t("lecturer.requireConsent"), consent, setConsent)}
        {toggle(t("lecturer.publishNow"), publish, setPublish)}
      </div>

      {error ? (
        <div role="alert" style={{ color: "rgb(var(--pink-rose))", fontSize: 13, marginTop: 10 }}>
          {error}
        </div>
      ) : null}
      <div className="row" style={{ gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={pending}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? t("lecturer.creating") : t("lecturer.createAssignment")}
        </button>
      </div>
    </form>
  );
}
