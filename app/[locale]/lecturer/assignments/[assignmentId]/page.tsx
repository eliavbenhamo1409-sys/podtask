import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Link } from "@/lib/i18n/navigation";
import { LecturerShell } from "@/components/lecturer/lecturer-shell";
import { Badge, Chip } from "@/components/podtask/chip";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { BackIcon } from "@/components/podtask/icons";
import { AddStudentsForm } from "@/components/lecturer/add-students-form";
import { AssignmentStatusBadge } from "@/components/lecturer/assignment-status-badge";
import { AssignmentStatusControl } from "@/components/lecturer/assignment-status-control";
import {
  getLecturerAssignment,
  getLecturerProfile,
} from "@/lib/lecturer/lecturer-service-server";
import type { LecturerStudentRow } from "@/lib/lecturer/types";
import { formatTime } from "@/lib/utils";
import { getTheme } from "@/lib/theme/server";
import { ForestAssignment } from "@/components/lecturer/forest/assignment";

interface PageProps {
  params: Promise<{ locale: string; assignmentId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("lecturer.assignment") };
}

function studentStatusKey(row: LecturerStudentRow): string {
  if (row.interviewStatus === "completed") return "lecturer.stCompleted";
  if (row.interviewStatus === "in_progress") return "lecturer.stInProgress";
  if (row.submissionStatus === "failed") return "lecturer.stFailed";
  if (row.submissionStatus === "interview_ready" || row.interviewStatus === "ready") return "lecturer.stReady";
  if (row.submissionStatus) return "lecturer.stProcessing";
  return "lecturer.stNotStarted";
}

const REVIEW_KEY = {
  unreviewed: "lecturer.reviewUnreviewed",
  reviewed: "lecturer.reviewReviewed",
  needs_clarification: "lecturer.reviewNeedsClarification",
  closed_no_finding: "lecturer.reviewClosed",
} as const;

export default async function LecturerAssignmentPage({ params }: PageProps) {
  const { locale, assignmentId } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const [profile, detail] = await Promise.all([
    getLecturerProfile(),
    getLecturerAssignment(assignmentId),
  ]);
  if (!detail) notFound();
  const a = detail.assignment;
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });

  if ((await getTheme()) === "forest") {
    return (
      <LecturerShell
        initial={profile?.avatarInitial}
        crumbs={[
          { label: t("forestLecturer.navOverview"), href: "/lecturer" },
          { label: a.courseName },
          { label: a.title },
        ]}
      >
        <ForestAssignment detail={detail} locale={locale} />
      </LecturerShell>
    );
  }

  return (
    <LecturerShell initial={profile?.avatarInitial}>
      <div className="page">
        <Link href="/lecturer" className="btn btn-ghost row" style={{ padding: "8px 0", gap: 8 }}>
          <span className="icon-flip">
            <BackIcon />
          </span>
          {t("lecturer.navDashboard")}
        </Link>

        <div className="between" style={{ flexWrap: "wrap", gap: 16, marginTop: 16, alignItems: "flex-end" }}>
          <div>
            <Eyebrow showDot>
              {a.courseName} · {a.courseCode}
            </Eyebrow>
            <h1 className="display" style={{ marginTop: 10 }}>
              {a.title}
            </h1>
            <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <AssignmentStatusBadge status={a.status} />
              <Chip>{t("lecturer.durationChip", { minutes: a.interviewDurationMinutes })}</Chip>
              <Chip>{a.language === "en" ? "English" : "עברית"}</Chip>
              <Chip variant={a.integrity.camera === "off" ? "default" : "cyan"}>
                {t("lecturer.camera")}:{" "}
                {a.integrity.camera === "off"
                  ? t("lecturer.cameraOff")
                  : a.integrity.camera === "required"
                    ? t("lecturer.cameraRequired")
                    : t("lecturer.cameraOn")}
              </Chip>
              {a.integrity.activityMonitoring ? <Chip>{t("lecturer.activityMonitoring")}</Chip> : null}
            </div>
          </div>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <AddStudentsForm courseId={a.courseId} />
            <AssignmentStatusControl assignmentId={a.id} status={a.status} />
          </div>
        </div>

        <div className="lx-grid-stats" style={{ marginTop: 24 }}>
          <div className="lx-stat">
            <div className="lx-stat-value">{a.invited}</div>
            <div className="lx-stat-label">{t("lecturer.invited")}</div>
          </div>
          <div className="lx-stat">
            <div className="lx-stat-value">{a.completed}</div>
            <div className="lx-stat-label">{t("lecturer.completed")}</div>
          </div>
          <div className="lx-stat">
            <div className="lx-stat-value">{a.pending}</div>
            <div className="lx-stat-label">{t("lecturer.pending")}</div>
          </div>
          <div className="lx-stat">
            <div className="lx-stat-value">{a.needsReview}</div>
            <div className="lx-stat-label">{t("lecturer.needsReview")}</div>
          </div>
          <div className="lx-stat">
            <div className="lx-stat-value">{a.averageScore ?? "–"}</div>
            <div className="lx-stat-label">{t("lecturer.avgScore")}</div>
          </div>
        </div>

        {a.description || a.instructions ? (
          <div className="card" style={{ padding: 24, marginTop: 24 }}>
            {a.description ? <p style={{ margin: 0, lineHeight: 1.6 }}>{a.description}</p> : null}
            {a.instructions ? (
              <p className="text-muted" style={{ margin: a.description ? "10px 0 0" : 0, lineHeight: 1.6, fontSize: 14 }}>
                {a.instructions}
              </p>
            ) : null}
          </div>
        ) : null}

        <h2 className="title" style={{ marginTop: 32 }}>
          {t("lecturer.studentsTitle")}
        </h2>
        {detail.students.length === 0 ? (
          <p className="text-muted">{t("lecturer.noStudents")}</p>
        ) : (
          <div className="lx-table-wrap" style={{ marginTop: 12 }}>
            <table className="lx-table">
              <thead>
                <tr>
                  <th>{t("lecturer.colStudent")}</th>
                  <th>{t("lecturer.colStatus")}</th>
                  <th>{t("lecturer.colCompleted")}</th>
                  <th>{t("lecturer.colScore")}</th>
                  <th>{t("lecturer.colSignals")}</th>
                  <th>{t("lecturer.colReview")}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {detail.students.map((s) => (
                  <tr key={s.studentId}>
                    <td>
                      <div style={{ fontWeight: 700 }}>
                        {s.fullName}{" "}
                        {s.isGuest ? <Chip>{t("lecturer.guest")}</Chip> : null}
                      </div>
                      <div className="text-muted" style={{ fontSize: 12 }}>
                        <bdi>{s.email}</bdi>
                      </div>
                    </td>
                    <td>{t(studentStatusKey(s))}</td>
                    <td>
                      {s.completedAt ? (
                        <>
                          <bdi>{dateFmt.format(new Date(s.completedAt))}</bdi>
                          {s.durationSeconds ? (
                            <div className="text-muted" style={{ fontSize: 12 }}>
                              {formatTime(s.durationSeconds)}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td>
                      {s.score !== null ? (
                        <span style={{ fontWeight: 800 }}>{s.score}</span>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td>
                      {s.flagsCount > 0 ? (
                        <Badge variant="amber">{s.flagsCount}</Badge>
                      ) : s.interviewStatus === "completed" ? (
                        <span className="text-muted">0</span>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td>
                      {s.interviewStatus === "completed" ? (
                        <>
                          {t(REVIEW_KEY[s.reviewStatus])}
                          {s.followUpRequested ? (
                            <div className="text-muted" style={{ fontSize: 12 }}>
                              {t("lecturer.followUpShort")}
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted">–</span>
                      )}
                    </td>
                    <td>
                      {s.interviewId && s.interviewStatus === "completed" ? (
                        <Link href={`/lecturer/interviews/${s.interviewId}`} className="btn btn-secondary" style={{ padding: "8px 12px", fontSize: 13 }}>
                          {t("lecturer.openReport")}
                        </Link>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </LecturerShell>
  );
}
