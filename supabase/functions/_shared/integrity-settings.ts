/**
 * Per-assignment integrity feature flags, resolved from
 * `assignments.settings.integrity` with safe defaults. The same module is
 * mirrored in `lib/integrity/settings.ts` for the Next.js app: keep both in
 * sync (the edge functions cannot import from `lib/`).
 *
 * Every feature is a flag an institution can turn off. Defaults:
 *   - lecturer assignments: camera REQUIRED to start (a recorded exemption
 *     path exists for accessibility and hardware problems), head orientation
 *     on, activity telemetry on, gentle silence nudges, overlap check, host
 *     flags, per-answer evaluation, consent screen.
 *   - personal (self-initiated) assignments: no camera, no activity
 *     telemetry; the conversational features stay on.
 *   - guest (one-shot demo) accounts: the lecturer defaults, even on the
 *     PERSONAL course. There are no real lecturers or students yet, so the
 *     guest path is where the whole flow is exercised (`isGuestIdentity`).
 */

export type CameraMode = "off" | "on" | "required";

export interface IntegritySettings {
  /**
   * off = never asked; on = asked, interview continues if declined;
   * required = must be granted to start (or a camera exemption recorded).
   */
  camera: CameraMode;
  /** Estimate head orientation on-device (sustained turn away / down). Needs the camera. */
  headPose: boolean;
  /** Record tab / focus / fullscreen / connection events during the interview. */
  activityMonitoring: boolean;
  /** Ask for fullscreen when the room opens (soft, never enforced). */
  fullscreen: boolean;
  /** Seconds of silence on the student's turn before the host's first gentle nudge. 0 disables. */
  silenceNudgeSeconds: number;
  /** Compare answers with the submitted document (server + the host's "in your own words" prompt). */
  overlapCheck: boolean;
  /** Give the host the flag_answer tool. */
  hostFlags: boolean;
  /** Run the per-question knowledge evaluation after the interview. */
  perAnswerEvaluation: boolean;
  /** Show the integrity notice and require the acknowledgement before the interview. */
  requireConsent: boolean;
  /** Version string stored with the acknowledgement. */
  consentVersion: string;
}

export const CONSENT_VERSION = "2026-10-14";

export const PERSONAL_COURSE_CODE = "PERSONAL";

export function isPersonalCourseCode(code: string | null | undefined): boolean {
  return (code ?? "").trim().toUpperCase() === PERSONAL_COURSE_CODE;
}

const GUEST_EMAIL_RE = /@guest\.podtask\.(app|local)$/i;

/**
 * A guest is the one-shot account minted by `create-guest-session`
 * (`user_metadata.is_guest`, e-mail on guest.podtask.app) or the older
 * anonymous `anon-…` profile. Accepts an auth user, JWT claims or a bare
 * profile e-mail.
 */
export function isGuestIdentity(
  identity:
    | { email?: string | null; metadata?: Record<string, unknown> | null }
    | null
    | undefined,
): boolean {
  if (!identity) return false;
  if (identity.metadata && identity.metadata.is_guest === true) return true;
  const email = (identity.email ?? "").trim();
  return GUEST_EMAIL_RE.test(email) || /^anon-/i.test(email);
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asCamera(value: unknown, fallback: CameraMode): CameraMode {
  return value === "off" || value === "on" || value === "required" ? value : fallback;
}

function asNudgeSeconds(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  if (value <= 0) return 0;
  return Math.min(120, Math.max(10, Math.round(value)));
}

/**
 * @param rawSettings  the `assignments.settings` jsonb (or null)
 * @param ctx.personal true for the per-institution PERSONAL course
 * @param ctx.guest    true for a guest (demo) account: the lecturer defaults
 *                     apply even on the PERSONAL course
 */
export function resolveIntegritySettings(
  rawSettings: unknown,
  ctx: { personal: boolean; guest?: boolean },
): IntegritySettings {
  const settings =
    rawSettings && typeof rawSettings === "object"
      ? (rawSettings as Record<string, unknown>)
      : {};
  const raw =
    settings.integrity && typeof settings.integrity === "object"
      ? (settings.integrity as Record<string, unknown>)
      : {};
  const personal = ctx.personal && ctx.guest !== true;
  return {
    camera: asCamera(raw.camera, personal ? "off" : "required"),
    headPose: asBool(raw.head_pose, true),
    activityMonitoring: asBool(raw.activity_monitoring, !personal),
    fullscreen: asBool(raw.fullscreen, false),
    silenceNudgeSeconds: asNudgeSeconds(raw.silence_nudge_seconds, 20),
    overlapCheck: asBool(raw.overlap_check, true),
    hostFlags: asBool(raw.host_flags, true),
    perAnswerEvaluation: asBool(raw.per_answer_evaluation, true),
    requireConsent: asBool(raw.require_consent, true),
    consentVersion: CONSENT_VERSION,
  };
}

/** The jsonb shape stored under `assignments.settings.integrity`. */
export interface IntegritySettingsInput {
  camera?: CameraMode;
  head_pose?: boolean;
  activity_monitoring?: boolean;
  fullscreen?: boolean;
  silence_nudge_seconds?: number;
  overlap_check?: boolean;
  host_flags?: boolean;
  per_answer_evaluation?: boolean;
  require_consent?: boolean;
}
