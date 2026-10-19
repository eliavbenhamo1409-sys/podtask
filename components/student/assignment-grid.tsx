"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/lib/i18n/navigation";
import { Chip } from "@/components/podtask/chip";
import { ArrowIcon, CalendarIcon, FileTextIcon } from "@/components/podtask/icons";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils";
import { AssignmentCard } from "./assignment-card";
import type { StudentAssignment } from "@/lib/student/types";

export interface AssignmentGridItem {
  assignment: StudentAssignment;
  href: string;
}

type Filter = "all" | "inProgress" | "completed";

const FILTERS: Array<{ id: Filter; labelKey: string }> = [
  { id: "all", labelKey: "dashboard.filterAll" },
  { id: "inProgress", labelKey: "dashboard.filterInProgress" },
  { id: "completed", labelKey: "dashboard.filterCompleted" },
];

function matches(a: StudentAssignment, filter: Filter): boolean {
  if (filter === "all") return true;
  if (filter === "completed") return a.status === "completed";
  return a.status !== "completed";
}

interface AssignmentGridProps {
  items: AssignmentGridItem[];
  /** Optional heading rendered on the same row as the filter chips. */
  title?: string;
  style?: React.CSSProperties;
}

/**
 * Assignment cards with working "all / in progress / completed" filters.
 * Hrefs are resolved on the server (they depend on submission/interview
 * lookups), so the client only filters and renders.
 */
export function AssignmentGrid({ items, title, style }: AssignmentGridProps) {
  const t = useTranslations();
  const { theme } = useTheme();
  const [filter, setFilter] = useState<Filter>("all");

  const counts: Record<Filter, number> = {
    all: items.length,
    inProgress: items.filter((i) => matches(i.assignment, "inProgress")).length,
    completed: items.filter((i) => matches(i.assignment, "completed")).length,
  };
  const visible = items.filter((i) => matches(i.assignment, filter));

  if (theme === "forest") {
    return (
      <AssignmentTable
        title={title}
        style={style}
        filter={filter}
        onFilter={setFilter}
        counts={counts}
        visible={visible}
      />
    );
  }

  return (
    <div style={style}>
      <div
        className="between"
        style={{ flexWrap: "wrap", gap: 12, alignItems: "center" }}
      >
        {title ? (
          <h2 className="title" style={{ margin: 0 }}>
            {title}
          </h2>
        ) : (
          <span />
        )}
        <div
          className="row"
          style={{ gap: 8, flexWrap: "wrap" }}
          role="group"
          aria-label={t("dashboard.allAssignments")}
        >
          {FILTERS.map((f) => (
            <Chip
              key={f.id}
              asButton
              variant={filter === f.id ? "cyan" : "default"}
              ariaPressed={filter === f.id}
              onClick={() => setFilter(f.id)}
            >
              {t(f.labelKey)} · {counts[f.id]}
            </Chip>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div
          className="card text-muted"
          style={{
            marginTop: 24,
            padding: 32,
            textAlign: "center",
            fontSize: 14,
            fontWeight: 500,
          }}
        >
          {t("dashboard.filterEmpty")}
        </div>
      ) : (
        // Keyed on the filter so cards replay their entrance when it changes.
        <div key={filter} className="grid-cards" style={{ marginTop: 24 }}>
          {visible.map((item, i) => (
            <AssignmentCard
              key={item.assignment.id}
              assignment={item.assignment}
              href={item.href}
              index={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Forest theme: the same filter state rendered as tabs + a table. On phones
   the CSS turns each row into a stacked card (styles/themes/forest/student-home.css).
   --------------------------------------------------------------------------- */

type Tone = "ok" | "amber" | "grey" | "danger";

const TABS: Array<{ id: Filter; labelKey: string }> = [
  { id: "all", labelKey: "forestHome.table.tabAll" },
  { id: "inProgress", labelKey: "forestHome.table.tabTodo" },
  { id: "completed", labelKey: "forestHome.table.tabDone" },
];

/** Status dot + label for every derived assignment status. */
function statusOf(a: StudentAssignment): { key: string; tone: Tone } {
  switch (a.status) {
    case "completed":
      return { key: "completed", tone: "ok" };
    case "ready_for_interview":
      return { key: "ready", tone: "ok" };
    case "processing":
      return { key: "processing", tone: "grey" };
    case "mic_test_required":
      return { key: "micTest", tone: "amber" };
    case "interview_in_progress":
      return { key: "inInterview", tone: "amber" };
    case "failed":
      return { key: "failed", tone: "danger" };
    default:
      return { key: "notStarted", tone: "amber" };
  }
}

/** The action label always names where the (server-resolved) href goes. */
function actionOf(a: StudentAssignment, href: string): string {
  if (a.status === "failed") return "details";
  if (href.endsWith("/upload")) return "upload";
  if (href.endsWith("/processing")) return "processing";
  if (href.endsWith("/mic-test")) return "micTest";
  if (href.endsWith("/lobby")) return "lobby";
  if (href.endsWith("/complete")) return "feedback";
  if (href.startsWith("/student/interviews/")) return "resume";
  return "details";
}

function formatDate(iso: string, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  // UTC keeps server and client output identical (no hydration mismatch).
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

interface AssignmentTableProps {
  title?: string;
  style?: React.CSSProperties;
  filter: Filter;
  onFilter: (f: Filter) => void;
  counts: Record<Filter, number>;
  visible: AssignmentGridItem[];
}

function AssignmentTable({ title, style, filter, onFilter, counts, visible }: AssignmentTableProps) {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <section className="fh-assign" style={style}>
      <div className={cn("fh-assign-head", !title && "no-title")}>
        {title ? <h2 className="fh-section-title">{title}</h2> : null}
        <div className="fh-tabs" role="group" aria-label={t("forestHome.table.tabsLabel")}>
          {TABS.map((tab) => {
            const active = filter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={cn("fh-tab", active && "active")}
                aria-pressed={active}
                onClick={() => onFilter(tab.id)}
              >
                <span>{t(tab.labelKey)}</span>
                <span className="fh-tab-count">{counts[tab.id]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="fh-empty">{t("forestHome.table.empty")}</p>
      ) : (
        <table className="fh-table" role="table">
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col" className="fh-c-title">
                {t("forestHome.table.colTitle")}
              </th>
              <th role="columnheader" scope="col" className="fh-c-course">
                {t("forestHome.table.colCourse")}
              </th>
              <th role="columnheader" scope="col" className="fh-c-date">
                {t("forestHome.table.colDue")}
              </th>
              <th role="columnheader" scope="col" className="fh-c-status">
                {t("forestHome.table.colStatus")}
              </th>
              <th role="columnheader" scope="col" className="fh-c-action">
                {t("forestHome.table.colAction")}
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {visible.map(({ assignment: a, href }) => {
              const actionKey = actionOf(a, href);
              // An interview that is still open wins over the derived status,
              // so the row never says "completed" next to "back to the conversation".
              const status =
                actionKey === "resume" ? { key: "inInterview", tone: "amber" as Tone } : statusOf(a);
              const action = t(`forestHome.action.${actionKey}`);
              const due = formatDate(a.dueAt, locale);
              return (
                <tr key={a.id} role="row" className="fh-row">
                  <td role="cell" className="fh-c-title">
                    <span className="fh-doc" aria-hidden>
                      <FileTextIcon size={24} />
                    </span>
                    <span className="fh-row-title">{a.title}</span>
                  </td>
                  <td role="cell" className="fh-c-course">
                    {a.courseName || "—"}
                  </td>
                  <td role="cell" className="fh-c-date">
                    <CalendarIcon size={15} className="fh-m-only" aria-hidden />
                    <bdi>{due ?? "—"}</bdi>
                  </td>
                  <td role="cell" className="fh-c-status">
                    <span className={cn("fh-status", `tone-${status.tone}`)}>
                      <span className="fh-dot" aria-hidden />
                      {t(`forestHome.status.${status.key}`)}
                    </span>
                  </td>
                  <td role="cell" className="fh-c-action">
                    <Link href={href} className="fh-link" aria-label={`${action}: ${a.title}`}>
                      {action}
                      <span className="icon-flip fh-arrow" aria-hidden>
                        <ArrowIcon size={20} />
                      </span>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
