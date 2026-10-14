"use client";

import type { IntegrityClientEvent } from "./types";

export type IntegrityEventSender = (
  events: IntegrityClientEvent[],
  opts: { keepalive: boolean },
) => Promise<void>;

const MAX_BATCH = 50;
const MAX_BUFFER = 400;

/**
 * Buffers telemetry events in the room and ships them in small batches, so a
 * burst of focus changes costs one request. `flush({ keepalive: true })` is
 * for pagehide, where only a keepalive fetch survives the navigation.
 * Failures are dropped: telemetry is best-effort and never blocks the room.
 */
export class IntegrityEventQueue {
  private buffer: IntegrityClientEvent[] = [];
  private timer: number | null = null;
  private disposed = false;

  constructor(
    private readonly send: IntegrityEventSender,
    private readonly intervalMs = 4000,
  ) {}

  push(event: IntegrityClientEvent): void {
    if (this.disposed) return;
    if (this.buffer.length >= MAX_BUFFER) this.buffer.shift();
    this.buffer.push(event);
    if (this.timer === null) {
      this.timer = window.setTimeout(() => {
        this.timer = null;
        void this.flush({ keepalive: false });
      }, this.intervalMs);
    }
  }

  get pending(): number {
    return this.buffer.length;
  }

  async flush(opts: { keepalive: boolean } = { keepalive: false }): Promise<void> {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.buffer.length > 0) {
      const batch = this.buffer.splice(0, MAX_BATCH);
      try {
        await this.send(batch, opts);
      } catch {
        /* best-effort */
      }
      if (opts.keepalive) break;
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    this.buffer = [];
  }
}
