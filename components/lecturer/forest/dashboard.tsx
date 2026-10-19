import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Link } from "@/lib/i18n/navigation";
import {
  ArrowIcon,
  BookIcon,
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  UsersIcon,
} from "@/components/podtask/icons";
import { NewCourseForm } from "@/components/lecturer/new-course-form";
import { NewAssignmentForm } from "@/components/lecturer/new-assignment-form";
import { AddStudentsForm } from "@/components/lecturer/add-students-form";
import type { LecturerAssignmentSummary, LecturerDashboard } from "@/lib/lecturer/types";
import { ASSIGNMENT_STATUS_KEY, ASSIGNMENT_TONE, type Tone } from "./util";

interface ForestDashboardProps {
  dashboard: LecturerDashboard;
  locale: string;
}

export function StatusDot({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="lxf-status" data-tone={tone}>
      <i aria-hidden />
      {children}
    </span>
  );
}

export function RowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="lxf-link">
      {children}
      <span className="icon-flip" aria-hidden>
        <ArrowIcon size={17} strokeWidth={1.8} />
      </span>
    </Link>
  );
}

export function Stat({
  icon,
  value,
  label,
  tone,
}: {
  icon: ReactNode;
  value: ReactNode;
  label: string;
  tone?: Tone;
}) {
  return (
    <li className="lxf-stat" data-tone={tone}>
      <span className="lxf-stat-icon" aria-hidden>
        {icon}
      </span>
      <span className="lxf-stat-text">
        <span className="lxf-stat-value">{value}</span>
        <span className="lxf-stat-label">{label}</span>
      </span>
    </li>
  );
}

/** Forest lecturer overview: what needs attention first, then every course. */
export async function ForestDashboard({ dashboard, locale }: ForestDashboardProps) {
  const t = await getTranslations();
  const f = (key: string, values?: Record<string, string | number>) => t(`forestLecturer.${key}`, values);
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  const { totals } = dashboard;

  const toReview: (LecturerAssignmentSummary & { courseName: string })[] = dashboard.courses.flatMap((c) =>
    c.assignments.filter((a) => a.needsReview > 0).map((a) => ({ ...a, courseName: c.name })),
  );

  return (
    <div className="lxf-page">
      <header className="lxf-head">
        <div className="lxf-head-text">
          {dashboard.profile.fullName ? (
            <p className="lxf-kicker">{f("greeting", { name: dashboard.profile.fullName })}</p>
          ) : null}
          <h1 className="lxf-title">{f("dashTitle")}</h1>
          <p className="lxf-sub">
            {totals.needsReview > 0 ? f("dashSubReview", { n: totals.needsReview }) : f("dashSubClear")}
          </p>
        </div>
        <div className="lxf-head-actions lxf-adds">
          <NewCourseForm />
        </div>
      </header>

      <ul className="lxf-stats" aria-label={f("statsLabel")}>
        <Stat icon={<BookIcon size={26} strokeWidth={1.5} />} value={totals.courses} label={f("statCourses")} />
        <Stat
          icon={<FileTextIcon size={26} strokeWidth={1.5} />}
          value={totals.assignments}
          label={f("statAssignments")}
        />
        <Stat icon={<UsersIcon size={26} strokeWidth={1.5} />} value={totals.students} label={f("statStudents")} />
        <Stat
          icon={<CheckIcon size={20} strokeWidth={2} />}
          value={totals.completed}
          label={f("statCompleted")}
          tone="ok"
        />
        <Stat
          icon={<ClockIcon size={25} strokeWidth={1.5} />}
          value={totals.needsReview}
          label={f("statNeedsReview")}
          tone={totals.needsReview > 0 ? "amber" : undefined}
        />
      </ul>

      <section className="lxf-card" aria-labelledby="lxf-review-title">
        <div className="lxf-card-head">
          <div>
            <h2 className="lxf-card-title" id="lxf-review-title">
              {f("reviewTitle")} <span className="lxf-count">({totals.needsReview})</span>
            </h2>
            <p className="lxf-card-sub">{f("reviewNote")}</p>
          </div>
        </div>
        {toReview.length === 0 ? (
          <div className="lxf-empty-row">
            <span className="lxf-empty-icon" aria-hidden>
              <CheckIcon size={16} strokeWidth={2.2} />
            </span>
            {f("reviewEmpty")}
          </div>
        ) : (
          <div className="lxf-table-wrap">
            <table className="lxf-table">
              <thead>
                <tr>
                  <th>{f("colAssignment")}</th>
                  <th>{f("colCourse")}</th>
                  <th>{f("colWaiting")}</th>
                  <th>{f("colProgress")}</th>
                  <th>{f("colAvg")}</th>
                  <th className="lxf-th-action">
                    <span className="lxf-sr">{f("colAction")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {toReview.map((a) => (
                  <tr key={a.id}>
                    <td className="lxf-td-main">
                      <span className="lxf-cell">
                        <span className="lxf-doc" aria-hidden>
                          <FileTextIcon size={22} strokeWidth={1.5} />
                        </span>
                        <span className="lxf-td-title">{a.title}</span>
                      </span>
                    </td>
                    <td data-label={f("colCourse")}>{a.courseName}</td>
                    <td data-label={f("colWaiting")}>
                      <StatusDot tone="amber">{f("waitingN", { n: a.needsReview })}</StatusDot>
                    </td>
                    <td data-label={f("colProgress")}>
                      <Progress done={a.completed} total={a.invited} label={f("progressN", { done: a.completed, total: a.invited })} />
                    </td>
                    <td data-label={f("colAvg")} className="lxf-num">
                      {a.averageScore ?? <span className="lxf-muted">–</span>}
                    </td>
                    <td className="lxf-td-action">
                      <RowLink href={`/lecturer/assignments/${a.id}`}>{f("toReview")}</RowLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {dashboard.courses.length === 0 ? (
        <section className="lxf-card lxf-empty-card">
          <h2 className="lxf-card-title">{t("lecturer.emptyTitle")}</h2>
          <p className="lxf-card-sub">{t("lecturer.emptyBody")}</p>
        </section>
      ) : (
        <h2 className="lxf-section-heading">{f("coursesTitle")}</h2>
      )}

      {dashboard.courses.map((course) => (
        <section key={course.id} className="lxf-card lxf-course" aria-label={course.name}>
          <div className="lxf-card-head">
            <div>
              <h3 className="lxf-card-title">
                {course.name} <span className="lxf-count">({course.assignments.length})</span>
              </h3>
              <ul className="lxf-meta">
                <li>
                  <bdi>{course.code}</bdi>
                </li>
                {course.semester ? <li>{course.semester}</li> : null}
                <li>{t("lecturer.students", { count: course.studentCount })}</li>
              </ul>
            </div>
            <div className="lxf-card-actions lxf-adds">
              <AddStudentsForm courseId={course.id} />
              <NewAssignmentForm courseId={course.id} courseName={course.name} />
            </div>
          </div>

          {course.assignments.length === 0 ? (
            <div className="lxf-empty-row lxf-empty-row-muted">{t("lecturer.noAssignments")}</div>
          ) : (
            <div className="lxf-table-wrap">
              <table className="lxf-table">
                <thead>
                  <tr>
                    <th>{f("colAssignment")}</th>
                    <th>{f("colDue")}</th>
                    <th>{f("colProgress")}</th>
                    <th>{f("colAvg")}</th>
                    <th>{f("colStatus")}</th>
                    <th className="lxf-th-action">
                      <span className="lxf-sr">{f("colAction")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {course.assignments.map((a) => (
                    <tr key={a.id}>
                      <td className="lxf-td-main">
                        <span className="lxf-cell">
                          <span className="lxf-doc" aria-hidden>
                            <FileTextIcon size={22} strokeWidth={1.5} />
                          </span>
                          <span className="lxf-td-title">{a.title}</span>
                        </span>
                      </td>
                      <td data-label={f("colDue")}>
                        {a.dueAt ? <bdi>{dateFmt.format(new Date(a.dueAt))}</bdi> : <span className="lxf-muted">{f("noDue")}</span>}
                      </td>
                      <td data-label={f("colProgress")}>
                        <Progress done={a.completed} total={a.invited} label={f("progressN", { done: a.completed, total: a.invited })} />
                      </td>
                      <td data-label={f("colAvg")} className="lxf-num">
                        {a.averageScore ?? <span className="lxf-muted">–</span>}
                      </td>
                      <td data-label={f("colStatus")}>
                        <StatusDot tone={ASSIGNMENT_TONE[a.status]}>{t(ASSIGNMENT_STATUS_KEY[a.status])}</StatusDot>
                      </td>
                      <td className="lxf-td-action">
                        <RowLink href={`/lecturer/assignments/${a.id}`}>{f("openAssignment")}</RowLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

export function Progress({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((Math.min(done, total) / total) * 100) : 0;
  return (
    <span className="lxf-progress">
      <span className="lxf-progress-bar" aria-hidden>
        <i style={{ width: `${pct}%` }} />
      </span>
      <span className="lxf-progress-text">{label}</span>
    </span>
  );
}
