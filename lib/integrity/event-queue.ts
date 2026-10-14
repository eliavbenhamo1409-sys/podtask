"use client";

import type { IntegrityClientEvent } from "./types";
import { newEventId } from "./types";

/**
 * What the transport reports back. `retry` keeps the batch for the next
 * attempt (network error, 5xx); `drop` discards it (the interview is over,
 * the server refused the batch); `ok` is stored. A thrown error counts as
 * `retry`.
 */
export type IntegritySendOutcome = "ok" | "retry" | "drop";

export type IntegrityEventSender = (
  events: IntegrityClientEvent[],
  opts: { keepalive: boolean },
) => Promise<IntegritySendOutcome | void>;

/** For the room's "monitoring active" badge. */
export type IntegritySyncState = "synced" | "pending" | "retrying" | "offline";

export interface IntegrityEventQueueOptions {
  /** How long a burst of events is collected before one request goes out. */
  intervalMs?: number;
  /** `sessionStorage` key for the unsent buffer; omit to keep it in memory only. */
  storageKey?: string;
  onSync?: (state: IntegritySyncState, pending: number) => void;
  /** Injected for tests. */
  now?: () => number;
}

const MAX_BATCH = 50;
const MAX_BUFFER = 400;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30_000;
const MAX_RETRIES_PER_BATCH = 8;

/**
 * Buffers telemetry events in the room and ships them in small batches, so a
 * burst of focus changes costs one request. Every event gets a client id and
 * a sequence number on `push`; the server dedupes on the id, so a retried or
 * re-sent batch never produces a second row. The unsent buffer is mirrored
 * to `sessionStorage` and re-sent after a reload. Failures back off and
 * retry; telemetry never blocks the room and never throws into it.
 */
export class IntegrityEventQueue {
  private buffer: IntegrityClientEvent[] = [];
  private timer: number | null = null;
  private retryTimer: number | null = null;
  private retries = 0;
  private flushing = false;
  private flushAgain = false;
  private disposed = false;
  private seq = 0;
  private sync: IntegritySyncState = "synced";
  private readonly intervalMs: number;
  private readonly storageKey: string | null;
  private readonly onSync: IntegrityEventQueueOptions["onSync"];
  private readonly now: () => number;

  constructor(
    private readonly send: IntegrityEventSender,
    opts: IntegrityEventQueueOptions | number = {},
  ) {
    const o = typeof opts === "number" ? { intervalMs: opts } : opts;
    this.intervalMs = o.intervalMs ?? 4000;
    this.storageKey = o.storageKey ?? null;
    this.onSync = o.onSync;
    this.now = o.now ?? (() => Date.now());
    this.restore();
    if (typeof window !== "undefined") {
      window.addEventListener("online", this.onOnline);
    }
    if (this.buffer.length > 0) this.schedule(250);
  }

  push(event: IntegrityClientEvent): void {
    if (this.disposed) return;
    const stamped: IntegrityClientEvent = {
      ...event,
      eventId: event.eventId ?? newEventId(),
      seq: event.seq ?? ++this.seq,
    };
    if (this.buffer.length >= MAX_BUFFER) this.buffer.shift();
    this.buffer.push(stamped);
    this.persist();
    this.setSync(this.sync === "retrying" || this.sync === "offline" ? this.sync : "pending");
    this.schedule(this.intervalMs);
  }

  get pending(): number {
    return this.buffer.length;
  }

  get syncState(): IntegritySyncState {
    return this.sync;
  }

  /**
   * Sends what is buffered now. With `keepalive` (pagehide) only ONE batch
   * goes out and nothing waits for the answer: the page is going away.
   */
  async flush(opts: { keepalive: boolean } = { keepalive: false }): Promise<void> {
    this.clearTimer();
    if (opts.keepalive) {
      if (this.buffer.length === 0) return;
      const batch = this.buffer.slice(0, MAX_BATCH);
      // Keep the batch persisted: if the keepalive request dies with the
      // page, the next load re-sends it and the server dedupes.
      this.persist();
      try {
        void this.send(batch, { keepalive: true }).then((r) => {
          if (r === "ok" || r === "drop") this.remove(batch);
        }).catch(() => {});
      } catch {
        /* best-effort */
      }
      return;
    }
    if (this.flushing) {
      this.flushAgain = true;
      return;
    }
    this.flushing = true;
    try {
      while (this.buffer.length > 0 && !this.disposed) {
        const batch = this.buffer.slice(0, MAX_BATCH);
        let outcome: IntegritySendOutcome = "retry";
        try {
          outcome = (await this.send(batch, { keepalive: false })) ?? "ok";
        } catch {
          outcome = "retry";
        }
        if (outcome === "retry") {
          this.retries += 1;
          if (this.retries > MAX_RETRIES_PER_BATCH) {
            // Give up on this batch rather than wedge everything behind it.
            this.remove(batch);
            this.retries = 0;
            continue;
          }
          const offline = typeof navigator !== "undefined" && navigator.onLine === false;
          this.setSync(offline ? "offline" : "retrying");
          const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.retries - 1));
          this.scheduleRetry(delay);
          return;
        }
        this.retries = 0;
        this.remove(batch);
      }
      this.setSync(this.buffer.length === 0 ? "synced" : "pending");
    } finally {
      this.flushing = false;
      if (this.flushAgain) {
        this.flushAgain = false;
        void this.flush({ keepalive: false });
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this.onOnline);
    }
    // The buffer stays persisted for the next load of the same interview.
    this.buffer = [];
  }

  private onOnline = (): void => {
    if (this.disposed) return;
    this.retries = 0;
    if (this.retryTimer !== null) {
      window.clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    void this.flush({ keepalive: false });
  };

  private schedule(ms: number): void {
    if (this.timer !== null || this.retryTimer !== null || typeof window === "undefined") return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.flush({ keepalive: false });
    }, ms);
  }

  private scheduleRetry(ms: number): void {
    if (this.retryTimer !== null || typeof window === "undefined") return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      void this.flush({ keepalive: false });
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null && typeof window !== "undefined") {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private remove(batch: IntegrityClientEvent[]): void {
    const ids = new Set(batch.map((e) => `${e.eventId}:${e.endedAt ?? ""}`));
    this.buffer = this.buffer.filter((e) => !ids.has(`${e.eventId}:${e.endedAt ?? ""}`));
    this.persist();
  }

  private setSync(state: IntegritySyncState): void {
    if (state === this.sync) return;
    this.sync = state;
    try {
      this.onSync?.(state, this.buffer.length);
    } catch {
      /* noop */
    }
  }

  private persist(): void {
    if (!this.storageKey || typeof window === "undefined") return;
    try {
      if (this.buffer.length === 0) window.sessionStorage.removeItem(this.storageKey);
      else window.sessionStorage.setItem(this.storageKey, JSON.stringify(this.buffer));
    } catch {
      /* quota / private mode */
    }
  }

  private restore(): void {
    if (!this.storageKey || typeof window === "undefined") return;
    try {
      const raw = window.sessionStorage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      const events = parsed.filter(
        (e): e is IntegrityClientEvent =>
          !!e && typeof e === "object" && typeof (e as IntegrityClientEvent).kind === "string",
      );
      this.buffer = events.slice(-MAX_BUFFER);
      for (const e of this.buffer) if (typeof e.seq === "number" && e.seq > this.seq) this.seq = e.seq;
      if (this.buffer.length > 0) this.sync = "pending";
    } catch {
      /* ignore a corrupt buffer */
    }
  }
}
