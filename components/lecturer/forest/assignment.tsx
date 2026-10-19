import { getTranslations } from "next-intl/server";
import {
  BarChartIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  UsersIcon,
} from "@/components/podtask/icons";
import { AddStudentsForm } from "@/components/lecturer/add-students-form";
import { AssignmentStatusControl } from "@/components/lecturer/assignment-status-control";
import type { LecturerAssignmentDetail } from "@/lib/lecturer/types";
import { formatTime } from "@/lib/utils";
import { RowLink, Stat, StatusDot } from "./dashboard";
import { ASSIGNMENT_STATUS_KEY, ASSIGNMENT_TONE, initialsOf, studentState } from "./util";

const REVIEW_KEY = {
  unreviewed: "lecturer.reviewUnreviewed",
  reviewed: "lecturer.reviewReviewed",
  needs_clarification: "lecturer.reviewNeedsClarification",
  closed_no_finding: "lecturer.reviewClosed",
} as const;

interface ForestAssignmentProps {
  detail: LecturerAssignmentDetail;
  locale: string;
}

/** Forest assignment page: the assignment's setup, its numbers, and the roster. */
export async function ForestAssignment({ detail, locale }: ForestAssignmentProps) {
  const t = await getTranslations();
  const f = (key: string, values?: Record<string, string | number>) => t(`forestLecturer.${key}`, values);
  const a = detail.assignment;
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const dateTimeFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const cameraLabel =
    a.integrity.camera === "off"
      ? t("lecturer.cameraOff")
      : a.integrity.camera === "required"
        ? t("lecturer.cameraRequired")
        : t("lecturer.cameraOn");

  return (
    <div className="lxf-page">
      <header className="lxf-head">
        <div className="lxf-head-text">
          <p className="lxf-kicker">
            {a.courseName} · <bdi>{a.courseCode}</bdi>
          </p>
          <h1 className="lxf-title">{a.title}</h1>
          <ul className="lxf-meta lxf-meta-lg">
            <li>
              <StatusDot tone={ASSIGNMENT_TONE[a.status]}>{t(ASSIGNMENT_STATUS_KEY[a.status])}</StatusDot>
            </li>
            <li>
              {a.dueAt ? (
                <>
                  {t("lecturer.dueAt")}: <bdi>{dateFmt.format(new Date(a.dueAt))}</bdi>
                </>
              ) : (
                f("noDue")
              )}
            </li>
            <li>{t("lecturer.durationChip", { minutes: a.interviewDurationMinutes })}</li>
            <li>{a.language === "en" ? "English" : "עברית"}</li>
            <li>
              {t("lecturer.camera")}: {cameraLabel}
            </li>
            {a.integrity.activityMonitoring ? <li>{t("lecturer.activityMonitoring")}</li> : null}
          </ul>
        </div>
        <div className="lxf-head-actions">
          <AddStudentsForm courseId={a.courseId} />
          <AssignmentStatusControl assignmentId={a.id} status={a.status} />
        </div>
      </header>

      <ul className="lxf-stats" aria-label={f("statsLabel")}>
        <Stat icon={<UsersIcon size={26} strokeWidth={1.5} />} value={a.invited} label={f("statInvited")} />
        <Stat icon={<CheckIcon size={20} strokeWidth={2} />} value={a.completed} label={f("statInterviewed")} tone="ok" />
        <Stat icon={<FileTextIcon size={26} strokeWidth={1.5} />} value={a.pending} label={f("statNotYet")} />
        <Stat
          icon={<ClockIcon size={25} strokeWidth={1.5} />}
          value={a.needsReview}
          label={f("statNeedsReview")}
          tone={a.needsReview > 0 ? "amber" : undefined}
        />
        <Stat
          icon={<BarChartIcon size={26} strokeWidth={1.5} />}
          value={a.averageScore ?? "–"}
          label={t("lecturer.avgScore")}
        />
      </ul>

      {a.description || a.instructions ? (
        <section className="lxf-card lxf-about">
          <h2 className="lxf-card-title">{f("aboutTitle")}</h2>
          <dl className="lxf-dl">
            {a.description ? (
              <div>
                <dt>{t("lecturer.description")}</dt>
                <dd>{a.description}</dd>
              </div>
            ) : null}
            {a.instructions ? (
              <div>
                <dt>{t("lecturer.instructions")}</dt>
                <dd>{a.instructions}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      ) : null}

      <section className="lxf-card" aria-labelledby="lxf-students-title">
        <div className="lxf-card-head">
          <h2 className="lxf-card-title" id="lxf-students-title">
            {t("lecturer.studentsTitle")} <span className="lxf-count">({detail.students.length})</span>
          </h2>
        </div>
        {detail.students.length === 0 ? (
          <div className="lxf-empty-row lxf-empty-row-muted">{t("lecturer.noStudents")}</div>
        ) : (
          <div className="lxf-table-wrap">
            <table className="lxf-table">
              <thead>
                <tr>
                  <th>{t("lecturer.colStudent")}</th>
                  <th>{f("colState")}</th>
                  <th>{f("colInterviewed")}</th>
                  <th>{t("lecturer.colScore")}</th>
                  <th>{f("colFlags")}</th>
                  <th>{t("lecturer.colReview")}</th>
                  <th className="lxf-th-action">
                    <span className="lxf-sr">{f("colAction")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.students.map((s) => {
                  const state = studentState(s);
                  const done = s.interviewStatus === "completed";
                  return (
                    <tr key={s.studentId}>
                      <td className="lxf-td-main">
                        <span className="lxf-cell">
                          <span className="lxf-initials" aria-hidden>
                            {initialsOf(s.fullName)}
                          </span>
                          <span className="lxf-person">
                            <span className="lxf-td-title">
                              {s.fullName}
                              {s.isGuest ? <span className="lxf-tag">{t("lecturer.guest")}</span> : null}
                            </span>
                            <bdi className="lxf-td-sub">{s.email}</bdi>
                          </span>
                        </span>
                      </td>
                      <td data-label={f("colState")}>
                        <StatusDot tone={state.tone}>{t(state.key)}</StatusDot>
                      </td>
                      <td data-label={f("colInterviewed")}>
                        {s.completedAt ? (
                          <span className="lxf-stack">
                            <bdi>{dateTimeFmt.format(new Date(s.completedAt))}</bdi>
                            {s.durationSeconds ? (
                              <span className="lxf-td-sub">{f("lengthN", { time: formatTime(s.durationSeconds) })}</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="lxf-muted">–</span>
                        )}
                      </td>
                      <td data-label={t("lecturer.colScore")} className="lxf-num">
                        {s.score !== null ? <strong>{s.score}</strong> : <span className="lxf-muted">–</span>}
                      </td>
                      <td data-label={f("colFlags")}>
                        {s.flagsCount > 0 ? (
                          <StatusDot tone="amber">{f("flagsN", { n: s.flagsCount })}</StatusDot>
                        ) : done ? (
                          <span className="lxf-muted">{f("flagsNone")}</span>
                        ) : (
                          <span className="lxf-muted">–</span>
                        )}
                      </td>
                      <td data-label={t("lecturer.colReview")}>
                        {done ? (
                          <span className="lxf-stack">
                            <span>{t(REVIEW_KEY[s.reviewStatus])}</span>
                            {s.followUpRequested ? (
                              <span className="lxf-td-sub">{t("lecturer.followUpShort")}</span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="lxf-muted">–</span>
                        )}
                      </td>
                      <td className="lxf-td-action">
                        {s.interviewId && done ? (
                          <RowLink href={`/lecturer/interviews/${s.interviewId}`}>{f("openReport")}</RowLink>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
