/**
 * Build-time feature flags read from `NEXT_PUBLIC_*` env vars.
 *
 * Next.js inlines `process.env.NEXT_PUBLIC_*` references at build time, so
 * these constants are safe in server components, client components and the
 * middleware alike. Keep every flag here so the rule lives in one place.
 */

/**
 * Mock mode drives every screen from `lib/student/mock-data.ts` and never
 * touches Supabase or OpenAI. NOTE the default: mock mode is ON unless the
 * variable is explicitly set to the string "false".
 */
export const MOCK_MODE = process.env.NEXT_PUBLIC_MOCK_MODE !== "false";

/**
 * Voice adapter for the interview room: "openai" opens a real WebRTC session
 * through the `create-realtime-session` edge function; anything else runs the
 * local timer-driven mock. Even in "openai" mode, non-UUID (demo) interview
 * ids fall back to mock — see `isUuidLike` in `lib/utils.ts`.
 */
export const REALTIME_ADAPTER: "openai" | "mock" =
  process.env.NEXT_PUBLIC_REALTIME_ADAPTER === "openai" ? "openai" : "mock";
