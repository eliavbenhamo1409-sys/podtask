"use client";

/**
 * Tab-lifetime cache of the signed-in student's avatar initial for the top
 * bar. Every student screen mounts its own TopBar; without this each client
 * navigation re-ran getUser + a profiles query from the browser (two round
 * trips to Supabase) and the avatar flickered empty while it waited.
 *
 * Cleared on logout and whenever the login screen mounts, so the next
 * student never sees the previous one's letter.
 */
import { getStudentProfile } from "./student-service";

let pending: Promise<string> | null = null;

export function getCachedProfileInitial(): Promise<string> {
  if (!pending) {
    pending = getStudentProfile()
      .then((p) => p.avatarInitial)
      .catch((err) => {
        // Don't cache failures; the next screen tries again.
        pending = null;
        throw err;
      });
  }
  return pending;
}

export function clearCachedProfileInitial(): void {
  pending = null;
}
