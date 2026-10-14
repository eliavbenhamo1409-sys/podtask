"use client";

/**
 * Lobby control for the interview language (Hebrew / English / Arabic).
 *
 * The choice is saved on `interviews.language` right away: the host's
 * session is minted from that row when the room opens, and it speaks,
 * listens and is transcribed in that language only. The three labels are
 * the languages' own names, so they need no translation.
 */

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Chip } from "@/components/podtask/chip";
import { setInterviewLanguage } from "@/lib/student/student-service";
import {
  INTERVIEW_LANGUAGES,
  type InterviewLanguage,
} from "@/lib/student/interview-language";

const LABELS: Record<InterviewLanguage, string> = {
  he: "עברית",
  en: "English",
  ar: "العربية",
};

interface InterviewLanguagePickerProps {
  interviewId: string;
  initial: InterviewLanguage;
}

export function InterviewLanguagePicker({
  interviewId,
  initial,
}: InterviewLanguagePickerProps) {
  const t = useTranslations();
  const [selected, setSelected] = useState<InterviewLanguage>(initial);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  async function choose(language: InterviewLanguage) {
    if (saving || language === selected) return;
    const previous = selected;
    setSelected(language);
    setFailed(false);
    setSaving(true);
    try {
      const ok = await setInterviewLanguage(interviewId, language);
      if (!ok) {
        setSelected(previous);
        setFailed(true);
      }
    } catch {
      setSelected(previous);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ marginTop: 28 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: "0.14em",
          color: "rgb(var(--ink-2))",
        }}
      >
        {t("lobby.languageTitle")}
      </div>
      <div
        className="row"
        role="group"
        aria-label={t("lobby.languageTitle")}
        aria-busy={saving || undefined}
        style={{ gap: 8, marginTop: 12, flexWrap: "wrap" }}
      >
        {INTERVIEW_LANGUAGES.map((language) => (
          <Chip
            key={language}
            asButton
            variant={language === selected ? "active" : "default"}
            ariaPressed={language === selected}
            onClick={() => void choose(language)}
          >
            <span dir="auto">{LABELS[language]}</span>
          </Chip>
        ))}
      </div>
      <div
        className="text-muted"
        role={failed ? "alert" : undefined}
        style={{
          fontSize: 12,
          marginTop: 8,
          lineHeight: 1.5,
          ...(failed ? { color: "rgb(var(--pink-deep))" } : {}),
        }}
      >
        {failed ? t("lobby.languageSaveFailed") : t("lobby.languageHint")}
      </div>
    </div>
  );
}
