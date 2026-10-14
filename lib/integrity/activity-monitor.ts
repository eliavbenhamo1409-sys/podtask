"use client";

import type { IntegrityClientEvent } from "./types";
import { newEventId } from "./types";

export interface ActivityMonitorOptions {
  onEvent: (event: IntegrityClientEvent) => void;
  /** Which planned question the conversation is on right now. */
  getPlanQuestionId: () => string | null;
  /** Called when the tab comes back after being hidden (for the student notice). */
  onReturn?: (info: { ordinal: number; durationMs: number }) => void;
  /** Window blur shorter than this is ignored (permission prompts, clicks on the URL bar). */
  blurMinMs?: number;
  /** A hidden episode shorter than this is dropped as flicker (rapid tab cycling, OS overlays). */
  hiddenGraceMs?: number;
  /** Record fullscreen enter / exit (only meaningful when the room asked for fullscreen). */
  trackFullscreen?: boolean;
  /** Injected for tests. */
  now?: () => number;
  /** Injected for tests. */
  doc?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState" | "fullscreenElement">;
  win?: Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;
}

/**
 * Event-based browser activity telemetry for the interview room:
 *   visibility_hidden  the tab was hidden (another tab, minimised, app switch).
 *                      Sent when it OPENS (after a short grace) and again when
 *                      it closes, with the duration, under the same eventId.
 *   tab_returned       the tab is visible again (point event; carries the
 *                      hidden id, the duration and the running count)
 *   window_blur        the window lost focus while visible (another window,
 *                      a devtools pane). Emitted when it ends; short blurs are
 *                      dropped. A blur alone is never counted as a tab switch.
 *   fullscreen_exit / fullscreen_enter
 *   page_hidden        the page is being unloaded (reload, navigation, close)
 *   offline            the browser reported losing the network
 *
 * `document.visibilityState` + `visibilitychange` is the source of truth;
 * blur / focus / pagehide are complementary signals. What a web page can see
 * is limited by design: a second device, a split screen or a window beside
 * the room never trigger any of this. The report says so.
 */
export class ActivityMonitor {
  private hiddenAt: number | null = null;
  private hiddenGraceTimer: number | null = null;
  private hiddenOpen: { id: string; startedAt: number; question: string | null } | null = null;
  private blurSince: number | null = null;
  private blurQuestion: string | null = null;
  private started = false;
  private exits = 0;
  private hiddenTotalMs = 0;
  // Counters for the per-turn metadata (reset by `drainCounters`).
  private hiddenMsSinceLast = 0;
  private blurCountSinceLast = 0;
  private readonly blurMinMs: number;
  private readonly hiddenGraceMs: number;
  private readonly trackFullscreen: boolean;
  private readonly now: () => number;
  private readonly doc: NonNullable<ActivityMonitorOptions["doc"]> | null;
  private readonly win: NonNullable<ActivityMonitorOptions["win"]> | null;

  constructor(private readonly opts: ActivityMonitorOptions) {
    this.blurMinMs = opts.blurMinMs ?? 1500;
    this.hiddenGraceMs = opts.hiddenGraceMs ?? 300;
    this.trackFullscreen = opts.trackFullscreen ?? false;
    this.now = opts.now ?? (() => Date.now());
    this.doc = opts.doc ?? (typeof document !== "undefined" ? document : null);
    this.win = opts.win ?? (typeof window !== "undefined" ? window : null);
  }

  /** How many hidden episodes were recorded so far (for the room's counter). */
  get exitCount(): number {
    return this.exits;
  }

  get hiddenTotal(): number {
    return this.hiddenTotalMs;
  }

  get isHidden(): boolean {
    return this.hiddenAt !== null;
  }

  start(): void {
    if (this.started || !this.doc || !this.win) return;
    this.started = true;
    this.doc.addEventListener("visibilitychange", this.onVisibility);
    this.win.addEventListener("blur", this.onBlur);
    this.win.addEventListener("focus", this.onFocus);
    this.win.addEventListener("pagehide", this.onPageHide);
    this.win.addEventListener("offline", this.onOffline);
    if (this.trackFullscreen) {
      this.doc.addEventListener("fullscreenchange", this.onFullscreen);
    }
    if (this.doc.visibilityState === "hidden") this.onVisibility();
  }

  stop(): void {
    if (!this.started || !this.doc || !this.win) return;
    this.started = false;
    const now = this.now();
    this.closeHidden(now, false);
    if (this.blurSince !== null) this.closeBlur(now);
    this.doc.removeEventListener("visibilitychange", this.onVisibility);
    this.win.removeEventListener("blur", this.onBlur);
    this.win.removeEventListener("focus", this.onFocus);
    this.win.removeEventListener("pagehide", this.onPageHide);
    this.win.removeEventListener("offline", this.onOffline);
    this.doc.removeEventListener("fullscreenchange", this.onFullscreen);
  }

  /** Counters since the previous call, for the next persisted answer. */
  drainCounters(): { hiddenMs: number; blurCount: number } {
    const out = { hiddenMs: this.hiddenMsSinceLast, blurCount: this.blurCountSinceLast };
    this.hiddenMsSinceLast = 0;
    this.blurCountSinceLast = 0;
    return out;
  }

  private emit(event: IntegrityClientEvent): void {
    try {
      this.opts.onEvent(event);
    } catch {
      /* never let telemetry break the room */
    }
  }

  private openHidden(startedAt: number): void {
    if (this.hiddenOpen) return;
    this.exits += 1;
    this.hiddenOpen = {
      id: newEventId(),
      startedAt,
      question: this.opts.getPlanQuestionId(),
    };
    this.emit({
      eventId: this.hiddenOpen.id,
      kind: "visibility_hidden",
      startedAt: new Date(this.hiddenOpen.startedAt).toISOString(),
      endedAt: null,
      durationMs: null,
      planQuestionId: this.hiddenOpen.question,
      payload: { phase: "open", ordinal: this.exits },
    });
  }

  /** Closes a hidden episode; `returned` is false on stop / unload. */
  private closeHidden(now: number, returned: boolean): void {
    if (this.hiddenGraceTimer !== null && this.win) {
      this.win.clearTimeout(this.hiddenGraceTimer);
      this.hiddenGraceTimer = null;
    }
    const startedAt = this.hiddenAt;
    this.hiddenAt = null;
    if (startedAt === null) return;
    const duration = Math.max(0, now - startedAt);
    if (!this.hiddenOpen) {
      // Shorter than the grace period: flicker, not an exit. (Timers are
      // throttled in hidden tabs, so the grace timer may not have fired yet.)
      if (duration < this.hiddenGraceMs && returned) return;
      this.openHidden(startedAt);
    }
    const open = this.hiddenOpen!;
    this.hiddenOpen = null;
    this.hiddenMsSinceLast += duration;
    this.hiddenTotalMs += duration;
    this.emit({
      eventId: open.id,
      kind: "visibility_hidden",
      startedAt: new Date(open.startedAt).toISOString(),
      endedAt: new Date(now).toISOString(),
      durationMs: duration,
      planQuestionId: open.question,
      payload: { phase: "close", ordinal: this.exits, returned },
    });
    if (returned) {
      this.emit({
        kind: "tab_returned",
        startedAt: new Date(now).toISOString(),
        planQuestionId: this.opts.getPlanQuestionId(),
        payload: { hidden_event_id: open.id, duration_ms: duration, ordinal: this.exits },
      });
      try {
        this.opts.onReturn?.({ ordinal: this.exits, durationMs: duration });
      } catch {
        /* noop */
      }
    }
  }

  private closeBlur(now: number): void {
    if (this.blurSince === null) return;
    const started = this.blurSince;
    this.blurSince = null;
    const duration = Math.max(0, now - started);
    if (duration < this.blurMinMs) return;
    this.blurCountSinceLast += 1;
    this.emit({
      kind: "window_blur",
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(now).toISOString(),
      durationMs: duration,
      planQuestionId: this.blurQuestion,
    });
  }

  private onVisibility = (): void => {
    if (!this.doc || !this.win) return;
    const now = this.now();
    if (this.doc.visibilityState === "hidden") {
      // A hidden tab also loses focus; count the episode once, as hidden.
      if (this.blurSince !== null) this.blurSince = null;
      if (this.hiddenAt === null) {
        this.hiddenAt = now;
        if (this.hiddenGraceTimer === null) {
          this.hiddenGraceTimer = this.win.setTimeout(() => {
            this.hiddenGraceTimer = null;
            if (this.hiddenAt !== null && this.doc?.visibilityState === "hidden") {
              this.openHidden(this.hiddenAt);
            }
          }, this.hiddenGraceMs);
        }
      }
    } else {
      this.closeHidden(now, true);
    }
  };

  private onBlur = (): void => {
    if (!this.doc || this.doc.visibilityState === "hidden") return;
    if (this.blurSince === null) {
      this.blurSince = this.now();
      this.blurQuestion = this.opts.getPlanQuestionId();
    }
  };

  private onFocus = (): void => {
    this.closeBlur(this.now());
  };

  private onFullscreen = (): void => {
    const entered = Boolean(this.doc?.fullscreenElement);
    this.emit({
      kind: entered ? "fullscreen_enter" : "fullscreen_exit",
      startedAt: new Date(this.now()).toISOString(),
      planQuestionId: this.opts.getPlanQuestionId(),
    });
  };

  private onPageHide = (): void => {
    const now = this.now();
    // Leaving while hidden: the episode ends here, without a return.
    this.closeHidden(now, false);
    if (this.blurSince !== null) this.closeBlur(now);
    this.emit({
      kind: "page_hidden",
      startedAt: new Date(now).toISOString(),
      planQuestionId: this.opts.getPlanQuestionId(),
    });
  };

  private onOffline = (): void => {
    this.emit({
      kind: "offline",
      startedAt: new Date(this.now()).toISOString(),
      planQuestionId: this.opts.getPlanQuestionId(),
    });
  };
}
