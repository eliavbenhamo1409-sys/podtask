"use client";

import type { IntegrityClientEvent } from "./types";

export interface ActivityMonitorOptions {
  onEvent: (event: IntegrityClientEvent) => void;
  /** Which planned question the conversation is on right now. */
  getPlanQuestionId: () => string | null;
  /** Window blur shorter than this is ignored (permission prompts, clicks on the URL bar). */
  blurMinMs?: number;
  /** Record fullscreen enter / exit (only meaningful when the room asked for fullscreen). */
  trackFullscreen?: boolean;
}

/**
 * Event-based browser activity telemetry for the interview room:
 *   visibility_hidden  the tab was hidden (another tab, minimised, app switch)
 *   window_blur        the window lost focus while visible (another window)
 *   fullscreen_exit / fullscreen_enter
 *   page_hidden        the page is being unloaded (reload, navigation)
 *   offline            the browser reported losing the network
 *
 * Intervals (hidden, blur) are emitted when they END, with their duration,
 * so a single event carries the whole episode. What a web page can see is
 * limited by design: a second device, a split screen or a window beside the
 * room never trigger any of this. The report says so.
 */
export class ActivityMonitor {
  private hiddenSince: number | null = null;
  private hiddenQuestion: string | null = null;
  private blurSince: number | null = null;
  private blurQuestion: string | null = null;
  private started = false;
  // Counters for the per-turn metadata (reset by `drainCounters`).
  private hiddenMsSinceLast = 0;
  private blurCountSinceLast = 0;
  private readonly blurMinMs: number;
  private readonly trackFullscreen: boolean;

  constructor(private readonly opts: ActivityMonitorOptions) {
    this.blurMinMs = opts.blurMinMs ?? 1500;
    this.trackFullscreen = opts.trackFullscreen ?? false;
  }

  start(): void {
    if (this.started || typeof document === "undefined") return;
    this.started = true;
    document.addEventListener("visibilitychange", this.onVisibility);
    window.addEventListener("blur", this.onBlur);
    window.addEventListener("focus", this.onFocus);
    window.addEventListener("pagehide", this.onPageHide);
    window.addEventListener("offline", this.onOffline);
    if (this.trackFullscreen) {
      document.addEventListener("fullscreenchange", this.onFullscreen);
    }
    if (document.visibilityState === "hidden") this.onVisibility();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    const now = Date.now();
    if (this.hiddenSince !== null) this.closeHidden(now);
    if (this.blurSince !== null) this.closeBlur(now);
    document.removeEventListener("visibilitychange", this.onVisibility);
    window.removeEventListener("blur", this.onBlur);
    window.removeEventListener("focus", this.onFocus);
    window.removeEventListener("pagehide", this.onPageHide);
    window.removeEventListener("offline", this.onOffline);
    document.removeEventListener("fullscreenchange", this.onFullscreen);
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

  private closeHidden(now: number): void {
    if (this.hiddenSince === null) return;
    const started = this.hiddenSince;
    this.hiddenSince = null;
    const duration = Math.max(0, now - started);
    this.hiddenMsSinceLast += duration;
    this.emit({
      kind: "visibility_hidden",
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(now).toISOString(),
      durationMs: duration,
      planQuestionId: this.hiddenQuestion,
    });
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
    const now = Date.now();
    if (document.visibilityState === "hidden") {
      // A hidden tab also loses focus; count the episode once, as hidden.
      if (this.blurSince !== null) this.blurSince = null;
      if (this.hiddenSince === null) {
        this.hiddenSince = now;
        this.hiddenQuestion = this.opts.getPlanQuestionId();
      }
    } else {
      this.closeHidden(now);
    }
  };

  private onBlur = (): void => {
    if (document.visibilityState === "hidden") return;
    if (this.blurSince === null) {
      this.blurSince = Date.now();
      this.blurQuestion = this.opts.getPlanQuestionId();
    }
  };

  private onFocus = (): void => {
    this.closeBlur(Date.now());
  };

  private onFullscreen = (): void => {
    const entered = Boolean(document.fullscreenElement);
    this.emit({
      kind: entered ? "fullscreen_enter" : "fullscreen_exit",
      startedAt: new Date().toISOString(),
      planQuestionId: this.opts.getPlanQuestionId(),
    });
  };

  private onPageHide = (): void => {
    const now = Date.now();
    if (this.hiddenSince !== null) this.closeHidden(now);
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
      startedAt: new Date().toISOString(),
      planQuestionId: this.opts.getPlanQuestionId(),
    });
  };
}
