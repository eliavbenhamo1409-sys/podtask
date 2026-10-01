"use client";

/**
 * Browser-only probe: requests microphone access once and immediately
 * releases the tracks. Used by the mic-test screen to drive
 * `MicPermissionState`. Returns "denied" when `navigator.mediaDevices` is
 * unavailable (SSR, insecure context) or the user refuses.
 */
export async function runMicPermissionCheck(): Promise<"granted" | "denied"> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices) return "denied";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return "granted";
  } catch {
    return "denied";
  }
}
