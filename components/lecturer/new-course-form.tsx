"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n/navigation";
import { createCourse } from "@/lib/lecturer/lecturer-service";

export function NewCourseForm() {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [semester, setSemester] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await createCourse(name.trim(), code.trim(), semester.trim());
    setPending(false);
    if (!result.ok) {
      setError(t("lecturer.errorGeneric"));
      return;
    }
    setOpen(false);
    setName("");
    setCode("");
    setSemester("");
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {t("lecturer.newCourse")}
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="card"
      style={{ padding: 20, borderRadius: 20, minWidth: 320, flex: "1 1 420px" }}
    >
      <div style={{ fontWeight: 800, fontSize: 15 }}>{t("lecturer.newCourse")}</div>
      <div className="lx-form-grid" style={{ marginTop: 12 }}>
        <label className="lx-field">
          <span>{t("lecturer.courseName")}</span>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="lx-field">
          <span>{t("lecturer.courseCode")}</span>
          <input className="input" required value={code} onChange={(e) => setCode(e.target.value)} />
        </label>
        <label className="lx-field">
          <span>{t("lecturer.semester")}</span>
          <input className="input" value={semester} onChange={(e) => setSemester(e.target.value)} />
        </label>
      </div>
      {error ? (
        <div role="alert" style={{ color: "rgb(var(--pink-rose))", fontSize: 13, marginTop: 10 }}>
          {error}
        </div>
      ) : null}
      <div className="row" style={{ gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={pending}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? t("lecturer.creating") : t("lecturer.create")}
        </button>
      </div>
    </form>
  );
}
