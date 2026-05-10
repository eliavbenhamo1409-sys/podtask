import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type SbClient = SupabaseClient<Database>;

export const STORAGE_BUCKETS = {
  ASSIGNMENT_FILES: "assignment-files",
  INTERVIEW_AUDIO: "interview-audio",
  TRANSCRIPTS: "transcripts",
  REPORT_PDFS: "report-pdfs",
  AVATARS: "avatars",
} as const;

export type BucketName = (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

const SIGNED_URL_TTL_SECONDS = 60 * 5;

export function assignmentFilePath(submissionId: string, filename: string) {
  const safe = filename.replace(/[^\w.\-]/g, "_");
  return `submissions/${submissionId}/${safe}`;
}

export function interviewAudioPath(interviewId: string, segmentId: string) {
  return `interviews/${interviewId}/${segmentId}.webm`;
}

export function transcriptPath(interviewId: string) {
  return `interviews/${interviewId}/transcript.json`;
}

export function reportPdfPath(reportId: string) {
  return `reports/${reportId}/report.pdf`;
}

export function avatarPath(userId: string, ext: string) {
  return `${userId}/avatar.${ext.replace(/^\./, "")}`;
}

export async function uploadToBucket(
  client: SbClient,
  bucket: BucketName,
  path: string,
  file: Blob,
  options?: { contentType?: string; upsert?: boolean },
) {
  const { data, error } = await client.storage.from(bucket).upload(path, file, {
    contentType: options?.contentType,
    upsert: options?.upsert ?? true,
    cacheControl: "3600",
  });
  if (error) throw error;
  return data;
}

export async function createSignedUrl(
  client: SbClient,
  bucket: BucketName,
  path: string,
  ttl = SIGNED_URL_TTL_SECONDS,
) {
  const { data, error } = await client.storage
    .from(bucket)
    .createSignedUrl(path, ttl);
  if (error) throw error;
  return data.signedUrl;
}

export async function getPublicUrl(
  client: SbClient,
  bucket: BucketName,
  path: string,
) {
  const { data } = client.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

export async function deleteFromBucket(
  client: SbClient,
  bucket: BucketName,
  paths: string[],
) {
  const { error } = await client.storage.from(bucket).remove(paths);
  if (error) throw error;
}
