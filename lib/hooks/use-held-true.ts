"use client";

import { useEffect, useState } from "react";

/**
 * Returns `true` while `value` is true and for `holdMs` after it falls.
 *
 * Used to smooth a flickery boolean (e.g. "host is speaking" derived from an
 * audio-level threshold) so UI driven by it does not strobe on syllable gaps.
 * On the rising edge the held flag is adjusted during render (React's
 * "adjust state from previous render" pattern), so no setState runs
 * synchronously inside an effect; only the trailing-edge timer sets state.
 */
export function useHeldTrue(value: boolean, holdMs: number): boolean {
  const [held, setHeld] = useState(value);
  if (value && !held) setHeld(true);
  useEffect(() => {
    if (value) return;
    const id = window.setTimeout(() => setHeld(false), holdMs);
    return () => window.clearTimeout(id);
  }, [value, holdMs]);
  return value || held;
}
