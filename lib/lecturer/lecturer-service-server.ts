/**
 * Server-side reads for the lecturer dashboard. Runs with the lecturer's
 * own cookie-bound Supabase client, so every row is RLS-filtered: a lecturer
 * only ever receives courses they lecture and the submissions, interviews,
 * reports, flags and telemetry that belong to them.
 *
 * In mock mode the dashboard renders a small fixture so the screens can be
 * previewed without a database.
 */
import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createClient as createServerSb } from "@/lib/supabase/server";
import { MOCK_MODE } from "@/lib/env";
import { isUuidLike } from "@/lib/utils";
import {
  isPersonalCourseCode,
  resolveIntegritySettings,
} from "@/lib/integrity/settings";
import { getReportForInterviewSb } from "@/lib/student/student-service-supabase";
import type {
  LecturerAssignmentDetail,
  LecturerAssignmentSummary,
  LecturerCourse,
  LecturerDashboard,
  LecturerInterviewReport,
  LecturerProfile,
  LecturerStudentRow,
  ReportEvaluation,
  ReportEvent,
  ReportFlag,
  ReportMessage,
  ReviewStatus,
} from "./types";
import {
  MOCK_LECTURER_ASSIGNMENT_DETAIL,
  MOCK_LECTURER_DASHBOARD,
  MOCK_LECTURER_REPORT,
} from "./mock-data";

type SbClient = SupabaseClient<Database>;

const getSb = cache(async (): Promise<SbClient> => {
  return (await createServerSb()) as unknown as SbClient;
});

function isGuestEmail(email: string): boolean {
  return /@guest\.podtask\.(app|local)$/i.test(email) || /^anon-/.test(email);
}

/** The signed-in user's profile and role; null when signed out. */
export const getLecturerProfile = cache(async function getLecturerProfile(): Promise<LecturerProfile | null> {
  if (MOCK_MODE) return MOCK_LECTURER_DASHBOARD.profile;
  const sb = await getSb();
  const { data: claims } = await sb.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string" || !userId) return null;
  const { data } = await sb
    .from("profiles")
    .select("id, email, full_name, role, institution:institutions ( name )")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  const inst = data.institution as { name: string } | { name: string }[] | null;
  const institutionName = Array.isArray(inst) ? inst[0]?.name ?? "" : inst?.name ?? "";
  const fullName = data.full_name ?? data.email;
  return {
    id: data.id,
    fullName,
    email: data.email,
    avatarInitial: fullName.slice(0, 1).toUpperCase(),
    institutionName,
    role: data.role,
  };
});

export function isStaff(profile: LecturerProfile | null): boolean {
  return profile?.role === "lecturer" || profile?.role === "admin";
}

interface CourseRow {
  id: string;
  name: string;
  code: string;
  semester: string | null;
}

interface AssignmentRow {
  id: string;
  course_id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  status: LecturerAssignmentSummary["status"];
  due_at: string | null;
  language: string;
  created_at: string;
  interview_duration_minutes: number;
  settings: unknown;
}

/** Course ids the user lectures (lecturer / ta membership), minus PERSONAL. */
async function lecturedCourses(sb: SbClient, userId: string): Promise<CourseRow[]> {
  const { data: memberships } = await sb
    .from("course_members")
    .select("course_id")
    .eq("user_id", userId)
    .in("role", ["lecturer", "ta"]);
  const ids = Array.from(new Set((memberships ?? []).map((m) => m.course_id)));
  if (ids.length === 0) return [];
  const { data: courses } = await sb
    .from("courses")
    .select("id, name, code, semester")
    .in("id", ids)
    .order("created_at", { ascending: false });
  return ((courses ?? []) as CourseRow[]).filter((c) => !isPersonalCourseCode(c.code));
}

interface Rollup {
  completedByAssignment: Map<string, number>;
  scoresByAssignment: Map<string, number[]>;
  needsReviewByAssignment: Map<string, number>;
}

/** Interview / report / flag / review counts for a set of assignments. */
async function rollup(sb: SbClient, assignmentIds: string[]): Promise<Rollup> {
  const out: Rollup = {
    completedByAssignment: new Map(),
    scoresByAssignment: new Map(),
    needsReviewByAssignment: new Map(),
  };
  if (assignmentIds.length === 0) return out;
  const [{ data: interviews }, { data: reports }] = await Promise.all([
    sb
      .from("interviews")
      .select("id, assignment_id, status")
      .in("assignment_id", assignmentIds)
      .eq("status", "completed"),
    sb
      .from("reports")
      .select("assignment_id, interview_id, rubric_result")
      .in("assignment_id", assignmentIds),
  ]);
  const completedIds: string[] = [];
  for (const i of interviews ?? []) {
    completedIds.push(i.id);
    out.completedByAssignment.set(
      i.assignment_id,
      (out.completedByAssignment.get(i.assignment_id) ?? 0) + 1,
    );
  }
  for (const r of reports ?? []) {
    const score = (r.rubric_result as { overall_score?: number } | null)?.overall_score;
    if (typeof score === "number") {
      const list = out.scoresByAssignment.get(r.assignment_id) ?? [];
      list.push(score);
      out.scoresByAssignment.set(r.assignment_id, list);
    }
  }
  if (completedIds.length > 0) {
    const [{ data: flags }, { data: reviews }] = await Promise.all([
      sb.from("interview_flags").select("interview_id").in("interview_id", completedIds),
      sb.from("interview_reviews").select("interview_id, status").in("interview_id", completedIds),
    ]);
    const reviewed = new Set(
      (reviews ?? [])
        .filter((r) => r.status !== "unreviewed")
        .map((r) => r.interview_id),
    );
    const flagged = new Set((flags ?? []).map((f) => f.interview_id));
    const assignmentOf = new Map((interviews ?? []).map((i) => [i.id, i.assignment_id]));
    for (const id of flagged) {
      if (reviewed.has(id)) continue;
      const a = assignmentOf.get(id);
      if (!a) continue;
      out.needsReviewByAssignment.set(a, (out.needsReviewByAssignment.get(a) ?? 0) + 1);
    }
  }
  return out;
}

function summarizeAssignment(
  a: AssignmentRow,
  course: CourseRow,
  invited: number,
  r: Rollup,
): LecturerAssignmentSummary {
  const completed = r.completedByAssignment.get(a.id) ?? 0;
  const scores = r.scoresByAssignment.get(a.id) ?? [];
  return {
    id: a.id,
    courseId: a.course_id,
    courseName: course.name,
    courseCode: course.code,
    title: a.title,
    status: a.status,
    dueAt: a.due_at,
    language: a.language,
    createdAt: a.created_at,
    interviewDurationMinutes: a.interview_duration_minutes,
    integrity: resolveIntegritySettings(a.settings, { personal: false }),
    invited,
    completed,
    pending: Math.max(0, invited - completed),
    needsReview: r.needsReviewByAssignment.get(a.id) ?? 0,
    averageScore: scores.length
      ? Math.round(scores.reduce((x, y) => x + y, 0) / scores.length)
      : null,
  };
}

export const getLecturerDashboard = cache(async function getLecturerDashboard(): Promise<LecturerDashboard | null> {
  if (MOCK_MODE) return MOCK_LECTURER_DASHBOARD;
  const profile = await getLecturerProfile();
  if (!profile || !isStaff(profile)) return null;
  const sb = await getSb();
  const courses = await lecturedCourses(sb, profile.id);
  const courseIds = courses.map((c) => c.id);
  if (courseIds.length === 0) {
    return {
      profile,
      courses: [],
      totals: { courses: 0, assignments: 0, students: 0, completed: 0, needsReview: 0 },
    };
  }
  const [{ data: members }, { data: assignments }] = await Promise.all([
    sb
      .from("course_members")
      .select("course_id, user_id")
      .in("course_id", courseIds)
      .eq("role", "student"),
    sb
      .from("assignments")
      .select("id, course_id, title, description, instructions, status, due_at, language, created_at, interview_duration_minutes, settings")
      .in("course_id", courseIds)
      .order("created_at", { ascending: false }),
  ]);
  const studentsByCourse = new Map<string, Set<string>>();
  for (const m of members ?? []) {
    const set = studentsByCourse.get(m.course_id) ?? new Set<string>();
    set.add(m.user_id);
    studentsByCourse.set(m.course_id, set);
  }
  const rows = (assignments ?? []) as AssignmentRow[];
  const r = await rollup(sb, rows.map((a) => a.id));

  const result: LecturerCourse[] = courses.map((c) => {
    const invited = studentsByCourse.get(c.id)?.size ?? 0;
    return {
      id: c.id,
      name: c.name,
      code: c.code,
      semester: c.semester,
      studentCount: invited,
      assignments: rows
        .filter((a) => a.course_id === c.id)
        .map((a) => summarizeAssignment(a, c, invited, r)),
    };
  });
  const allAssignments = result.flatMap((c) => c.assignments);
  const allStudents = new Set<string>();
  for (const set of studentsByCourse.values()) for (const id of set) allStudents.add(id);
  return {
    profile,
    courses: result,
    totals: {
      courses: result.length,
      assignments: allAssignments.length,
      students: allStudents.size,
      completed: allAssignments.reduce((n, a) => n + a.completed, 0),
      needsReview: allAssignments.reduce((n, a) => n + a.needsReview, 0),
    },
  };
});

export const getLecturerAssignment = cache(async function getLecturerAssignment(
  assignmentId: string,
): Promise<LecturerAssignmentDetail | null> {
  if (MOCK_MODE || !isUuidLike(assignmentId)) {
    return MOCK_MODE ? MOCK_LECTURER_ASSIGNMENT_DETAIL : null;
  }
  const profile = await getLecturerProfile();
  if (!profile || !isStaff(profile)) return null;
  const sb = await getSb();
  const { data: a } = await sb
    .from("assignments")
    .select("id, course_id, title, description, instructions, status, due_at, language, created_at, interview_duration_minutes, settings, course:courses ( id, name, code, semester )")
    .eq("id", assignmentId)
    .maybeSingle();
  if (!a) return null;
  const courseRaw = a.course as CourseRow | CourseRow[] | null;
  const course = Array.isArray(courseRaw) ? courseRaw[0] : courseRaw;
  if (!course) return null;

  const [{ data: members }, { data: submissions }, { data: interviews }] = await Promise.all([
    sb
      .from("course_members")
      .select("user_id, profile:profiles ( id, full_name, email )")
      .eq("course_id", course.id)
      .eq("role", "student"),
    sb
      .from("submissions")
      .select("id, student_id, status")
      .eq("assignment_id", assignmentId),
    sb
      .from("interviews")
      .select("id, student_id, status, completed_at, duration_seconds")
      .eq("assignment_id", assignmentId),
  ]);
  const interviewIds = (interviews ?? []).map((i) => i.id);
  const [{ data: reports }, { data: flags }, { data: reviews }] = interviewIds.length
    ? await Promise.all([
        sb.from("reports").select("interview_id, overall_level, rubric_result").in("interview_id", interviewIds),
        sb.from("interview_flags").select("interview_id").in("interview_id", interviewIds),
        sb.from("interview_reviews").select("interview_id, status, follow_up_requested").in("interview_id", interviewIds),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];

  const subByStudent = new Map((submissions ?? []).map((s) => [s.student_id, s]));
  const intByStudent = new Map((interviews ?? []).map((i) => [i.student_id, i]));
  const reportByInterview = new Map((reports ?? []).map((r) => [r.interview_id, r]));
  const flagsByInterview = new Map<string, number>();
  for (const f of flags ?? []) {
    flagsByInterview.set(f.interview_id, (flagsByInterview.get(f.interview_id) ?? 0) + 1);
  }
  const reviewByInterview = new Map((reviews ?? []).map((r) => [r.interview_id, r]));

  const students: LecturerStudentRow[] = (members ?? [])
    .map((m) => {
      const pRaw = m.profile as { id: string; full_name: string | null; email: string } | { id: string; full_name: string | null; email: string }[] | null;
      const p = Array.isArray(pRaw) ? pRaw[0] : pRaw;
      const id = p?.id ?? m.user_id;
      const email = p?.email ?? "";
      const sub = subByStudent.get(id);
      const int = intByStudent.get(id);
      const rep = int ? reportByInterview.get(int.id) : undefined;
      const rev = int ? reviewByInterview.get(int.id) : undefined;
      const score = (rep?.rubric_result as { overall_score?: number } | null)?.overall_score;
      return {
        studentId: id,
        fullName: p?.full_name ?? email,
        email,
        isGuest: isGuestEmail(email),
        submissionId: sub?.id ?? null,
        submissionStatus: sub?.status ?? null,
        interviewId: int?.id ?? null,
        interviewStatus: int?.status ?? null,
        completedAt: int?.completed_at ?? null,
        durationSeconds: int?.duration_seconds ?? null,
        score: typeof score === "number" ? Math.round(score) : null,
        level: rep?.overall_level ?? null,
        flagsCount: int ? (flagsByInterview.get(int.id) ?? 0) : 0,
        reviewStatus: (rev?.status as ReviewStatus | undefined) ?? "unreviewed",
        followUpRequested: rev?.follow_up_requested === true,
      };
    })
    .sort((x, y) => x.fullName.localeCompare(y.fullName));

  const r = await rollup(sb, [assignmentId]);
  const summary = summarizeAssignment(a as unknown as AssignmentRow, course, students.length, r);
  return {
    assignment: {
      ...summary,
      description: a.description ?? "",
      instructions: a.instructions ?? "",
    },
    students,
  };
});

export const getLecturerInterviewReport = cache(async function getLecturerInterviewReport(
  interviewId: string,
): Promise<LecturerInterviewReport | null> {
  if (MOCK_MODE || !isUuidLike(interviewId)) {
    return MOCK_MODE ? MOCK_LECTURER_REPORT : null;
  }
  const profile = await getLecturerProfile();
  if (!profile || !isStaff(profile)) return null;
  const sb = await getSb();
  const { data: interview } = await sb
    .from("interviews")
    .select("id, status, language, started_at, completed_at, duration_seconds, metadata, student_id, assignment_id, submission_id")
    .eq("id", interviewId)
    .maybeSingle();
  if (!interview) return null;

  const [
    { data: student },
    { data: assignment },
    { data: outline },
    { data: messages },
    { data: evaluations },
    { data: flags },
    { data: events },
    { data: consent },
    { data: review },
    report,
  ] = await Promise.all([
    sb.from("profiles").select("id, full_name, email").eq("id", interview.student_id).maybeSingle(),
    sb
      .from("assignments")
      .select("id, title, settings, course:courses ( name, code )")
      .eq("id", interview.assignment_id)
      .maybeSingle(),
    sb.rpc("interview_outline", { p_interview_id: interviewId }),
    sb
      .from("interview_messages")
      .select("id, speaker, content, plan_question_id, created_at, metadata")
      .eq("interview_id", interviewId)
      .order("created_at", { ascending: true }),
    sb
      .from("answer_evaluations")
      .select("question_id, understanding_level, clarity_score, conceptual_score, reasoning_score, consistency_score, evidence, gaps, raw_output")
      .eq("interview_id", interviewId),
    sb
      .from("interview_flags")
      .select("id, plan_question_id, category, description, quote, evidence, confidence, limitations, source, created_at")
      .eq("interview_id", interviewId)
      .order("created_at", { ascending: true }),
    sb
      .from("interview_integrity_events")
      .select("id, kind, source, plan_question_id, started_at, ended_at, duration_ms, payload")
      .eq("interview_id", interviewId)
      .order("started_at", { ascending: true }),
    sb
      .from("interview_consents")
      .select("accepted_at, version")
      .eq("interview_id", interviewId)
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    sb
      .from("interview_reviews")
      .select("status, follow_up_requested, note, updated_at")
      .eq("interview_id", interviewId)
      .maybeSingle(),
    getReportForInterviewSb(sb, interviewId),
  ]);

  const courseRaw = assignment?.course as { name: string; code: string } | { name: string; code: string }[] | null | undefined;
  const course = Array.isArray(courseRaw) ? courseRaw[0] : courseRaw;
  const questions = ((outline as { questions?: { id: string; topic?: string; question?: string | null; kind?: string | null }[] } | null)?.questions ?? []).map((q) => ({
    id: q.id,
    topic: q.topic ?? "",
    question: q.question ?? "",
    kind: q.kind ?? null,
  }));
  const metadata = (interview.metadata ?? {}) as Record<string, unknown>;
  const email = student?.email ?? "";

  return {
    interview: {
      id: interview.id,
      status: interview.status,
      language: interview.language,
      startedAt: interview.started_at,
      completedAt: interview.completed_at,
      durationSeconds: interview.duration_seconds,
      attempts: typeof metadata.attempts === "number" ? metadata.attempts : 1,
      integritySummary:
        metadata.integrity_summary && typeof metadata.integrity_summary === "object"
          ? (metadata.integrity_summary as Record<string, unknown>)
          : null,
    },
    student: {
      id: interview.student_id,
      fullName: student?.full_name ?? email,
      email,
      isGuest: isGuestEmail(email),
    },
    assignment: {
      id: interview.assignment_id,
      title: assignment?.title ?? "",
      courseName: course?.name ?? "",
      courseCode: course?.code ?? "",
      integrity: resolveIntegritySettings(assignment?.settings, {
        personal: isPersonalCourseCode(course?.code),
      }),
    },
    questions,
    report,
    messages: (messages ?? [])
      .filter((m) => typeof m.content === "string" && m.content.trim().length > 0)
      .map(
        (m): ReportMessage => ({
          id: m.id,
          speaker: m.speaker,
          content: (m.content ?? "").trim(),
          planQuestionId: m.plan_question_id,
          createdAt: m.created_at,
          metadata: (m.metadata ?? {}) as Record<string, unknown>,
        }),
      ),
    evaluations: (evaluations ?? []).map((e): ReportEvaluation => {
      const raw = (e.raw_output ?? {}) as Record<string, unknown>;
      const n = (v: unknown): number | null => (typeof v === "number" ? v : null);
      return {
        questionId: e.question_id,
        understandingLevel: e.understanding_level,
        scores: {
          relevance: n(raw.relevance),
          accuracy: n(raw.accuracy) ?? e.conceptual_score,
          explanation: n(raw.explanation) ?? e.clarity_score,
          consistency: n(raw.consistency) ?? e.consistency_score,
          process: n(raw.process),
          application: n(raw.application) ?? e.reasoning_score,
        },
        evidence: Array.isArray(e.evidence) ? (e.evidence as string[]) : [],
        gaps: Array.isArray(e.gaps) ? (e.gaps as string[]) : [],
        summary: typeof raw.summary === "string" ? raw.summary : null,
      };
    }),
    flags: (flags ?? []).map(
      (f): ReportFlag => ({
        id: f.id,
        planQuestionId: f.plan_question_id,
        category: f.category,
        description: f.description,
        quote: f.quote,
        evidence: Array.isArray(f.evidence) ? (f.evidence as unknown[]) : [],
        confidence: (f.confidence as ReportFlag["confidence"]) ?? "low",
        limitations: f.limitations,
        source: f.source,
        createdAt: f.created_at,
      }),
    ),
    events: (events ?? []).map(
      (e): ReportEvent => ({
        id: e.id,
        kind: e.kind,
        source: e.source,
        planQuestionId: e.plan_question_id,
        startedAt: e.started_at,
        endedAt: e.ended_at,
        durationMs: e.duration_ms,
        payload: (e.payload ?? {}) as Record<string, unknown>,
      }),
    ),
    consent: consent ? { acceptedAt: consent.accepted_at, version: consent.version } : null,
    review: review
      ? {
          status: review.status as ReviewStatus,
          followUpRequested: review.follow_up_requested,
          note: review.note,
          updatedAt: review.updated_at,
        }
      : null,
  };
});
