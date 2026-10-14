"use client";

/**
 * Browser-side writes of the lecturer dashboard. Everything goes through
 * RLS (assignments insert/update for courses the user lectures, reviews) or
 * SECURITY DEFINER RPCs that check the caller's role themselves. In mock
 * mode the calls succeed without touching anything.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/client";
import { MOCK_MODE } from "@/lib/env";
import type { IntegritySettingsInput } from "@/lib/integrity/settings";
import type { ReviewStatus } from "./types";

// Same cast as the student service: the SSR browser client's generic does
// not line up with supabase-js's, so the typed client is asserted once here.
function sbClient(): SupabaseClient<Database> {
  return createClient() as unknown as SupabaseClient<Database>;
}

export interface NewAssignmentInput {
  courseId: string;
  title: string;
  description: string;
  instructions: string;
  language: "he" | "en";
  dueAt: string | null;
  interviewDurationMinutes: number;
  publish: boolean;
  integrity: IntegritySettingsInput;
}

export async function createCourse(
  name: string,
  code: string,
  semester: string,
): Promise<{ ok: true; courseId: string } | { ok: false; error: string }> {
  if (MOCK_MODE) return { ok: true, courseId: "mock-course" };
  const sb = sbClient();
  const { data, error } = await sb.rpc("lecturer_create_course", {
    p_name: name,
    p_code: code,
    p_semester: semester || undefined,
  });
  if (error || !data) return { ok: false, error: error?.message ?? "create_course_failed" };
  return { ok: true, courseId: data };
}

export async function addStudentsByEmail(
  courseId: string,
  emails: string[],
): Promise<{ ok: true; added: string[]; missing: string[]; already: string[] } | { ok: false; error: string }> {
  if (MOCK_MODE) return { ok: true, added: emails, missing: [], already: [] };
  const sb = sbClient();
  const { data, error } = await sb.rpc("lecturer_add_course_members", {
    p_course_id: courseId,
    p_emails: emails,
  });
  if (error || !data) return { ok: false, error: error?.message ?? "add_members_failed" };
  const r = data as { added?: string[]; missing?: string[]; already?: string[] };
  return { ok: true, added: r.added ?? [], missing: r.missing ?? [], already: r.already ?? [] };
}

export async function createAssignment(
  input: NewAssignmentInput,
): Promise<{ ok: true; assignmentId: string } | { ok: false; error: string }> {
  if (MOCK_MODE) return { ok: true, assignmentId: "mock-assignment" };
  const sb = sbClient();
  const { data, error } = await sb
    .from("assignments")
    .insert({
      course_id: input.courseId,
      title: input.title,
      description: input.description || null,
      instructions: input.instructions || null,
      language: input.language,
      due_at: input.dueAt,
      interview_duration_minutes: input.interviewDurationMinutes,
      status: input.publish ? "published" : "draft",
      settings: { integrity: { ...input.integrity } } as unknown as Json,
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "create_assignment_failed" };
  return { ok: true, assignmentId: data.id };
}

export async function setAssignmentStatus(
  assignmentId: string,
  status: "draft" | "published" | "closed",
): Promise<boolean> {
  if (MOCK_MODE) return true;
  const sb = sbClient();
  const { error } = await sb.from("assignments").update({ status }).eq("id", assignmentId);
  return !error;
}

export async function saveReview(
  interviewId: string,
  input: { status: ReviewStatus; followUpRequested: boolean; note: string },
): Promise<boolean> {
  if (MOCK_MODE) return true;
  const sb = sbClient();
  const {
    data: { session },
  } = await sb.auth.getSession();
  const reviewerId = session?.user?.id;
  if (!reviewerId) return false;
  const { error } = await sb.from("interview_reviews").upsert(
    {
      interview_id: interviewId,
      reviewer_id: reviewerId,
      status: input.status,
      follow_up_requested: input.followUpRequested,
      note: input.note || null,
    },
    { onConflict: "interview_id" },
  );
  return !error;
}
