"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Chip } from "@/components/podtask/chip";
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
  const [filter, setFilter] = useState<Filter>("all");

  const counts: Record<Filter, number> = {
    all: items.length,
    inProgress: items.filter((i) => matches(i.assignment, "inProgress")).length,
    completed: items.filter((i) => matches(i.assignment, "completed")).length,
  };
  const visible = items.filter((i) => matches(i.assignment, filter));

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
