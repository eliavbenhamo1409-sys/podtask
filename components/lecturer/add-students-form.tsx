"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/lib/i18n/navigation";
import { addStudentsByEmail } from "@/lib/lecturer/lecturer-service";
import { isValidUsername } from "@/lib/auth/username";

export function AddStudentsForm({ courseId }: { courseId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ added: string[]; missing: string[]; already: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    // E-mails or usernames; the RPC matches an entry without "@" by username.
    const entries = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes("@") || isValidUsername(s));
    if (entries.length === 0) return;
    setPending(true);
    setError(null);
    const r = await addStudentsByEmail(courseId, entries);
    setPending(false);
    if (!r.ok) {
      setError(t("lecturer.errorGeneric"));
      return;
    }
    setResult({ added: r.added, missing: r.missing, already: r.already });
    setRaw("");
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
        {t("lecturer.addStudents")}
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="card" style={{ padding: 20, borderRadius: 20, flex: "1 1 100%" }}>
      <div style={{ fontWeight: 800, fontSize: 15 }}>{t("lecturer.addStudents")}</div>
      <p className="text-muted" style={{ fontSize: 13, margin: "6px 0 10px" }}>
        {t("lecturer.addStudentsHint")}
      </p>
      <textarea
        className="input lx-textarea"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="noa.levi"
        dir="ltr"
      />
      {result ? (
        <div style={{ fontSize: 13, marginTop: 10, lineHeight: 1.6 }}>
          <div>{t("lecturer.added", { count: result.added.length })}</div>
          {result.already.length ? <div>{t("lecturer.already", { count: result.already.length })}</div> : null}
          {result.missing.length ? (
            <div style={{ color: "rgb(var(--pink-rose))" }}>
              {t("lecturer.missing", { emails: result.missing.join(", ") })}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div role="alert" style={{ color: "rgb(var(--pink-rose))", fontSize: 13, marginTop: 10 }}>
          {error}
        </div>
      ) : null}
      <div className="row" style={{ gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)} disabled={pending}>
          {t("common.cancel")}
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {t("lecturer.addStudentsCta")}
        </button>
      </div>
    </form>
  );
}
