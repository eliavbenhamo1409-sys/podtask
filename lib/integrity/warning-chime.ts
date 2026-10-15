"use client";

/**
 * A short, soft two-note chime for the moment a warning sign appears on
 * the camera self-view. Synthesised with WebAudio, so there is no asset to
 * load and nothing to download. Quiet by design: it should make the
 * student glance at the sign, not startle them while they are answering.
 *
 * Browsers only let audio start after a user gesture. The room is reached
 * by a click (the mic-test's start button), so the context is normally
 * allowed; when it is not, the chime fails silently and the visual sign
 * still shows.
 */

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;
  const Ctor: AudioContextCtor | undefined =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Two descending notes (A5, E5), ~0.4 s in all, peak gain 0.16. */
export function playWarningChime(): void {
  const ac = context();
  if (!ac) return;
  try {
    if (ac.state === "suspended") void ac.resume().catch(() => {});
    const t0 = ac.currentTime + 0.02;
    const notes: [frequency: number, offset: number][] = [
      [880, 0],
      [659.25, 0.16],
    ];
    for (const [frequency, offset] of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      const start = t0 + offset;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(start);
      osc.stop(start + 0.26);
      osc.addEventListener("ended", () => {
        osc.disconnect();
        gain.disconnect();
      });
    }
  } catch {
    /* no sound is fine; the sign is still shown */
  }
}
