/**
 * Small helpers for the forest lecturer screens. Pure: no React, no data.
 */
import type { AppRole, AssignmentStatus, LecturerStudentRow, ReviewStatus } from "@/lib/lecturer/types";

/** Status dot colours used across the forest lecturer screens. */
export type Tone = "ok" | "amber" | "muted" | "danger" | "info";

/** One breadcrumb in the forest lecturer top bar. */
export interface Crumb {
  label: string;
  href?: string;
}

// Titles that should not become an initial ("ד״ר נועה לוי" -> "נל").
const HONORIFIC = /^(ד["״'׳]?ר|פרופ['׳]?|פרופסור|dr\.?|prof\.?|mr\.?|mrs\.?|ms\.?)$/i;

/** Up to two initials from a person's name, skipping academic titles. */
export function initialsOf(name: string): string {
  const words = name
    .split(/[\s/]+/)
    .filter(Boolean)
    .filter((w) => !HONORIFIC.test(w));
  const letters = words.slice(0, 2).map((w) => Array.from(w)[0] ?? "");
  return letters.join("").toUpperCase() || "?";
}

export function roleKey(role: AppRole): string {
  if (role === "admin") return "forestLecturer.roleAdmin";
  if (role === "student") return "forestLecturer.roleStudent";
  return "forestLecturer.roleLecturer";
}

export const ASSIGNMENT_TONE: Record<AssignmentStatus, Tone> = {
  published: "ok",
  draft: "muted",
  closed: "amber",
  archived: "muted",
};

export const ASSIGNMENT_STATUS_KEY: Record<AssignmentStatus, string> = {
  published: "forestLecturer.statusPublished",
  draft: "forestLecturer.statusDraft",
  closed: "forestLecturer.statusClosed",
  archived: "forestLecturer.statusArchived",
};

/** Where one student stands on an assignment, as a label key and a dot colour. */
export function studentState(row: LecturerStudentRow): { key: string; tone: Tone } {
  if (row.interviewStatus === "completed") return { key: "lecturer.stCompleted", tone: "ok" };
  if (row.interviewStatus === "in_progress") return { key: "lecturer.stInProgress", tone: "danger" };
  if (row.submissionStatus === "failed") return { key: "lecturer.stFailed", tone: "danger" };
  if (row.submissionStatus === "interview_ready" || row.interviewStatus === "ready") {
    return { key: "lecturer.stReady", tone: "amber" };
  }
  if (row.submissionStatus) return { key: "lecturer.stProcessing", tone: "muted" };
  return { key: "lecturer.stNotStarted", tone: "muted" };
}

export const REVIEW_PILL: Record<ReviewStatus, { key: string; tone: Tone }> = {
  unreviewed: { key: "forestLecturer.pillUnreviewed", tone: "amber" },
  reviewed: { key: "forestLecturer.pillReviewed", tone: "ok" },
  needs_clarification: { key: "forestLecturer.pillNeedsClarification", tone: "danger" },
  closed_no_finding: { key: "forestLecturer.pillClosed", tone: "muted" },
};

/** "mm:ss" for an offset in milliseconds. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
