import { setRequestLocale, getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { Link } from "@/lib/i18n/navigation";
import { LecturerShell } from "@/components/lecturer/lecturer-shell";
import { Badge, Chip } from "@/components/podtask/chip";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { NewCourseForm } from "@/components/lecturer/new-course-form";
import { NewAssignmentForm } from "@/components/lecturer/new-assignment-form";
import { AddStudentsForm } from "@/components/lecturer/add-students-form";
import { AssignmentStatusBadge } from "@/components/lecturer/assignment-status-badge";
import { getLecturerDashboard } from "@/lib/lecturer/lecturer-service-server";
import { getTheme } from "@/lib/theme/server";
import { ForestDashboard } from "@/components/lecturer/forest/dashboard";
import { firstNameOf } from "@/components/lecturer/forest/util";

interface PageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale });
  return { title: t("lecturer.brand") };
}

export default async function LecturerDashboardPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations();
  const dashboard = await getLecturerDashboard();
  if (!dashboard) return null;

  if ((await getTheme()) === "forest") {
    return (
      <LecturerShell initial={dashboard.profile.avatarInitial}>
        <ForestDashboard dashboard={dashboard} locale={locale} />
      </LecturerShell>
    );
  }

  const stats = [
    { label: t("lecturer.statCourses"), value: dashboard.totals.courses },
    { label: t("lecturer.statAssignments"), value: dashboard.totals.assignments },
    { label: t("lecturer.statStudents"), value: dashboard.totals.students },
    { label: t("lecturer.statCompleted"), value: dashboard.totals.completed },
    { label: t("lecturer.statNeedsReview"), value: dashboard.totals.needsReview },
  ];

  return (
    <LecturerShell initial={dashboard.profile.avatarInitial}>
      <div className="page">
        <div className="between" style={{ flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
          <div>
            <Eyebrow showDot>{t("lecturer.brand")}</Eyebrow>
            <h1 className="display" style={{ marginTop: 10 }}>
              {t("lecturer.dashboardTitle", { name: firstNameOf(dashboard.profile.fullName) })}
            </h1>
            <p className="subtitle" style={{ maxWidth: 620 }}>
              {t("lecturer.dashboardSubtitle")}
            </p>
          </div>
          <NewCourseForm />
        </div>

        <div className="lx-grid-stats" style={{ marginTop: 28 }}>
          {stats.map((s) => (
            <div key={s.label} className="lx-stat">
              <div className="lx-stat-value">{s.value}</div>
              <div className="lx-stat-label">{s.label}</div>
            </div>
          ))}
        </div>

        {dashboard.courses.length === 0 ? (
          <div className="card" style={{ padding: 40, marginTop: 32, textAlign: "center" }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{t("lecturer.emptyTitle")}</div>
            <p className="subtitle" style={{ maxWidth: 520, margin: "8px auto 0" }}>
              {t("lecturer.emptyBody")}
            </p>
          </div>
        ) : null}

        {dashboard.courses.map((course) => (
          <section key={course.id} className="card" style={{ padding: 28, marginTop: 28 }}>
            <div className="between" style={{ flexWrap: "wrap", gap: 12 }}>
              <div>
                <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
                  <h2 className="title" style={{ margin: 0 }}>
                    {course.name}
                  </h2>
                  <Chip variant="cyan">{course.code}</Chip>
                  {course.semester ? <Chip>{course.semester}</Chip> : null}
                </div>
                <div className="text-muted" style={{ fontSize: 13, marginTop: 6 }}>
                  {t("lecturer.students", { count: course.studentCount })}
                </div>
              </div>
              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <AddStudentsForm courseId={course.id} />
                <NewAssignmentForm courseId={course.id} courseName={course.name} />
              </div>
            </div>

            {course.assignments.length === 0 ? (
              <p className="text-muted" style={{ fontSize: 14, marginTop: 18 }}>
                {t("lecturer.noAssignments")}
              </p>
            ) : (
              <div className="lx-table-wrap" style={{ marginTop: 18 }}>
                <table className="lx-table">
                  <thead>
                    <tr>
                      <th>{t("lecturer.assignment")}</th>
                      <th>{t("lecturer.colStatus")}</th>
                      <th>{t("lecturer.invited")}</th>
                      <th>{t("lecturer.completed")}</th>
                      <th>{t("lecturer.pending")}</th>
                      <th>{t("lecturer.needsReview")}</th>
                      <th>{t("lecturer.avgScore")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {course.assignments.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link href={`/lecturer/assignments/${a.id}`} className="lx-row-link">
                            {a.title}
                          </Link>
                          {a.dueAt ? (
                            <div className="text-muted" style={{ fontSize: 12, marginTop: 2 }}>
                              {t("lecturer.dueAt")}:{" "}
                              <bdi>
                                {new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
                                  new Date(a.dueAt),
                                )}
                              </bdi>
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <AssignmentStatusBadge status={a.status} />
                        </td>
                        <td>{a.invited}</td>
                        <td>{a.completed}</td>
                        <td>{a.pending}</td>
                        <td>
                          {a.needsReview > 0 ? (
                            <Badge variant="amber">{a.needsReview}</Badge>
                          ) : (
                            <span className="text-muted">0</span>
                          )}
                        </td>
                        <td>{a.averageScore ?? <span className="text-muted">–</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </LecturerShell>
  );
}
