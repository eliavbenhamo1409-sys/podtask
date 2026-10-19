import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { StudentAppShell } from "@/components/student/student-app-shell";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { Badge } from "@/components/podtask/chip";
import {
  ArrowIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  FilePlusIcon,
  FileTextIcon,
} from "@/components/podtask/icons";
import { Link } from "@/lib/i18n/navigation";
import { getStudentHistory } from "@/lib/student/student-service-server";
import { getTheme } from "@/lib/theme/server";
import { formatTime } from "@/lib/utils";

interface HistoryPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("screens.history") };
}

export default async function HistoryPage({ params }: HistoryPageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const entries = await getStudentHistory();

  const intl = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  });

  if ((await getTheme()) === "forest") {
    const numeric = new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
    const dateOf = (iso: string) => {
      const d = new Date(iso);
      return iso && !Number.isNaN(d.getTime()) ? numeric.format(d) : "—";
    };
    const lengthOf = (seconds: number) =>
      seconds > 0
        ? `${Math.max(1, Math.round(seconds / 60))} ${t("common.minutes")}`
        : "—";

    return (
      <StudentAppShell>
        <div className="page fh-history">
          <header className="fh-head">
            <h1 className="display">{t("forestHome.history.title")}</h1>
            <p className="subtitle">{t("forestHome.history.subtitle")}</p>
          </header>

          {entries.length === 0 ? (
            <div className="card fh-card fh-empty-card">
              <p>{t("forestHome.history.empty")}</p>
              <Link href="/student/self/new" className="btn btn-primary">
                {t("forestHome.history.emptyCta")}
                <FilePlusIcon size={20} aria-hidden />
              </Link>
            </div>
          ) : (
            <section className="fh-assign">
              <div className="fh-assign-head">
                <h2 className="fh-section-title fh-count">
                  {t("forestHome.history.count", { count: entries.length })}
                </h2>
              </div>
              <table className="fh-table fh-table-history" role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader" scope="col" className="fh-c-title">
                      {t("forestHome.history.colTitle")}
                    </th>
                    <th role="columnheader" scope="col" className="fh-c-course">
                      {t("forestHome.history.colCourse")}
                    </th>
                    <th role="columnheader" scope="col" className="fh-c-date">
                      {t("forestHome.history.colDate")}
                    </th>
                    <th role="columnheader" scope="col" className="fh-c-status">
                      {t("forestHome.history.colDuration")}
                    </th>
                    <th role="columnheader" scope="col" className="fh-c-action">
                      {t("forestHome.history.colAction")}
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {entries.map((e) => (
                    <tr key={e.interviewId ?? e.assignmentId} role="row" className="fh-row">
                      <td role="cell" className="fh-c-title">
                        <span className="fh-doc" aria-hidden>
                          <FileTextIcon size={24} />
                        </span>
                        <span className="fh-row-title">{e.title}</span>
                      </td>
                      <td role="cell" className="fh-c-course">
                        {e.courseName || "—"}
                      </td>
                      <td role="cell" className="fh-c-date">
                        <CalendarIcon size={15} className="fh-m-only" aria-hidden />
                        <bdi>{dateOf(e.interviewedAt)}</bdi>
                      </td>
                      <td role="cell" className="fh-c-status fh-c-length">
                        <ClockIcon size={15} className="fh-m-only" aria-hidden />
                        {lengthOf(e.durationSeconds)}
                      </td>
                      <td role="cell" className="fh-c-action">
                        {e.interviewId ? (
                          <Link
                            href={`/student/interviews/${e.interviewId}/complete`}
                            className="fh-link"
                            aria-label={`${t("forestHome.history.open")}: ${e.title}`}
                          >
                            {t("forestHome.history.open")}
                            <span className="icon-flip fh-arrow" aria-hidden>
                              <ArrowIcon size={20} />
                            </span>
                          </Link>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      </StudentAppShell>
    );
  }

  return (
    <StudentAppShell>
      <div className="page">
        <Eyebrow showDot>{t("screens.history")}</Eyebrow>
        <h1 className="display">{t("history.title")}</h1>
        <p className="subtitle">{t("history.subtitle")}</p>

        <div style={{ marginTop: 32 }}>
          {entries.length === 0 ? (
            <div className="card" style={{ padding: 40, textAlign: "center" }}>
              <p className="text-muted" style={{ fontSize: 15 }}>
                {t("history.empty")}
              </p>
            </div>
          ) : (
            <div className="flex-col" style={{ gap: 16 }}>
              {entries.map((e) => (
                <div
                  key={e.assignmentId}
                  className="card"
                  style={{ padding: 24 }}
                >
                  <div className="between">
                    <Badge variant="mint">
                      <CheckIcon size={12} />
                      {t("status.completed")}
                    </Badge>
                    <div
                      className="text-muted row"
                      style={{
                        gap: 8,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      <ClockIcon /> {formatTime(e.durationSeconds)}
                    </div>
                  </div>
                  <h3
                    style={{
                      margin: "16px 0 6px",
                      fontSize: 19,
                      fontWeight: 800,
                      letterSpacing: "-0.01em",
                    }}
                  >
                    {e.title}
                  </h3>
                  <div
                    className="text-muted"
                    style={{ fontSize: 13, fontWeight: 500 }}
                  >
                    {e.courseName}
                  </div>
                  <div
                    className="between"
                    style={{ marginTop: 16, gap: 12, flexWrap: "wrap" }}
                  >
                    <div
                      className="row"
                      style={{
                        gap: 16,
                        rowGap: 6,
                        flexWrap: "wrap",
                        fontSize: 12,
                        color: "rgb(var(--ink-2))",
                        fontWeight: 600,
                      }}
                    >
                      <span>
                        {t("history.uploaded")}:{" "}
                        <bdi>{intl.format(new Date(e.uploadedAt))}</bdi>
                      </span>
                      <span style={{ color: "rgb(var(--line))" }}>·</span>
                      <span>
                        {t("history.interviewed")}:{" "}
                        <bdi>{intl.format(new Date(e.interviewedAt))}</bdi>
                      </span>
                    </div>
                    {e.interviewId && (
                      <Link
                        href={`/student/interviews/${e.interviewId}/complete`}
                        className="btn btn-secondary"
                        style={{ padding: "10px 16px", fontSize: 13 }}
                      >
                        {t("history.openReport")}
                        <span className="icon-flip">
                          <ArrowIcon size={14} />
                        </span>
                      </Link>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </StudentAppShell>
  );
}
