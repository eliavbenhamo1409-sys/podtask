/**
 * Paces the host's live captions to her voice.
 *
 * WHY. Over WebRTC, OpenAI Realtime sends the transcript of the host's speech
 * (`response.output_audio_transcript.delta`) on the data channel at generation
 * speed — several times faster than the audio, which arrives on the media
 * track and plays in real time. The deltas carry no timestamps and OpenAI
 * documents no way to align them ("the realtime model doesn't have enough
 * information to precisely align transcript and audio"). What the API does
 * give, WebRTC-only and per response, is `output_audio_buffer.started` (the
 * server began streaming audio) and `output_audio_buffer.stopped` (the buffer
 * drained, no more audio is coming) / `.cleared` (cut off).
 *
 * HOW. Text is buffered per response ("turn") and revealed word by word at
 * the host's speaking rate while her audio is audible; whatever is left is
 * flushed when the buffer stops. The rate starts at a per-language guess and
 * is re-calibrated after every spoken turn (characters ÷ audible time), so
 * from the second turn on it tracks the actual voice.
 *
 * The class is pure and framework-agnostic: the room feeds it events and a
 * clock, polls `tick()` a few times a second and renders `snapshot()`.
 */

export interface PacedCaption {
  id: string;
  /** The part of the turn revealed so far. */
  text: string;
  /** True once the turn was fully spoken and fully revealed. */
  final: boolean;
}

export interface CaptionPacerOptions {
  /** Initial speaking rate, characters per second (re-calibrated per turn). */
  charsPerSecond: number;
  /** Bounds for the calibrated rate. */
  minCharsPerSecond?: number;
  maxCharsPerSecond?: number;
  /** Audio level (0..1 RMS) above which the host counts as audible. */
  audibleLevel?: number;
  /** Speech still counts as audible this long after the last loud frame. */
  audibleHoldMs?: number;
  /** Clock speed during silences inside a started turn (breaths, pauses). */
  silentClockFactor?: number;
  /** Start pacing anyway this long after a turn's first delta if neither a
   *  start event nor audible audio arrived (defensive). */
  startFallbackMs?: number;
  /** Largest step the clock may take between ticks (hidden-tab throttling). */
  maxTickMs?: number;
  makeId?: () => string;
}

interface Turn {
  id: string;
  responseId?: string;
  /** Everything received so far (concatenated deltas, replaced by the final text). */
  buffered: string;
  /** Number of characters revealed on screen. */
  revealed: number;
  /** The final transcript arrived. */
  finalized: boolean;
  /** Audio playback began (start event, audible audio, or the fallback). */
  started: boolean;
  /** Audio playback ended (stopped / cleared, or flushed by a later turn). */
  done: boolean;
  firstDeltaAt: number;
  /** Accumulated "spoken" time, ms (audible time + a fraction of pauses). */
  clockMs: number;
}

const DEFAULTS = {
  minCharsPerSecond: 5,
  maxCharsPerSecond: 30,
  audibleLevel: 0.07,
  audibleHoldMs: 300,
  silentClockFactor: 0.25,
  startFallbackMs: 2500,
  maxTickMs: 250,
};

let idCounter = 0;
function defaultMakeId(): string {
  idCounter += 1;
  return `cap_${idCounter.toString(36)}_${Date.now().toString(36)}`;
}

export class CaptionPacer {
  private turns: Turn[] = [];
  private rate: number; // chars per ms
  private calibrations = 0;
  private lastAudibleAt = Number.NEGATIVE_INFINITY;
  private levelSamples = 0;
  private lastTickAt: number | null = null;
  /** A start event that arrived before the turn's first delta. */
  private pendingStart: { responseId?: string } | null = null;
  private version = 0;
  private snapshotVersion = -1;
  private snapshotCache: PacedCaption[] = [];
  private readonly opts: Required<CaptionPacerOptions>;

  constructor(options: CaptionPacerOptions) {
    this.opts = {
      ...DEFAULTS,
      makeId: defaultMakeId,
      ...options,
    };
    this.rate = this.opts.charsPerSecond / 1000;
  }

  /** Current speaking-rate estimate, characters per second. */
  get charsPerSecond(): number {
    return this.rate * 1000;
  }

  /** Monotonic counter bumped on every visible change. */
  get revision(): number {
    return this.version;
  }

  reset(): void {
    this.turns = [];
    this.pendingStart = null;
    this.lastTickAt = null;
    this.lastAudibleAt = Number.NEGATIVE_INFINITY;
    this.bump();
  }

  // ---- Inputs ----

  /** A streaming transcript chunk of the host's speech. */
  pushDelta(delta: string, now: number, responseId?: string): void {
    if (!delta) return;
    let turn = responseId ? this.findByResponse(responseId) : undefined;
    if (!turn) {
      const last = this.turns[this.turns.length - 1];
      const lastIsOpen =
        last &&
        !last.finalized &&
        (!responseId || !last.responseId || last.responseId === responseId);
      if (lastIsOpen) {
        turn = last;
        if (responseId && !turn.responseId) turn.responseId = responseId;
      } else {
        turn = this.newTurn(now, responseId);
      }
    }
    turn.buffered += delta;
    this.bump();
  }

  /** The final transcript of a turn (transcript.done / item.done). */
  finalize(text: string, now: number, responseId?: string): void {
    const byId = responseId ? this.findByResponse(responseId) : undefined;
    const last = this.turns[this.turns.length - 1];
    const turn = byId ?? (last && !last.finalized ? last : undefined);
    if (turn) {
      if (turn.finalized && byId) return;
      const prev = this.turns[this.turns.indexOf(turn) - 1];
      // `conversation.item.done` for the previous turn arriving after the
      // next turn already started streaming: ignore the duplicate.
      if (prev?.finalized && text && prev.buffered.trim() === text.trim()) {
        return;
      }
      if (text) {
        turn.buffered = text;
        turn.revealed = Math.min(turn.revealed, text.length);
      }
      turn.finalized = true;
      if (turn.done) turn.revealed = turn.buffered.length;
      this.bump();
      return;
    }
    if (!text) return;
    if (last?.finalized && last.buffered.trim() === text.trim()) return;
    // Text that never streamed (no deltas, no audio): show it at once.
    const fresh = this.newTurn(now, responseId);
    fresh.buffered = text;
    fresh.revealed = text.length;
    fresh.finalized = true;
    fresh.started = true;
    fresh.done = true;
    this.bump();
  }

  /** `output_audio_buffer.started`: the server began streaming this response's audio. */
  playbackStarted(now: number, responseId?: string): void {
    const turn =
      (responseId ? this.findByResponse(responseId) : undefined) ??
      this.turns.find((t) => !t.started && !t.done);
    if (!turn) {
      this.pendingStart = { responseId };
      return;
    }
    this.start(turn, now);
  }

  /** `output_audio_buffer.stopped` / `.cleared`: no more audio for this response. */
  playbackStopped(now: number, responseId?: string): void {
    if (
      this.pendingStart &&
      (!responseId || !this.pendingStart.responseId || this.pendingStart.responseId === responseId)
    ) {
      this.pendingStart = null;
    }
    const turn =
      (responseId ? this.findByResponse(responseId) : undefined) ??
      this.turns.find((t) => t.started && !t.done) ??
      this.turns.find((t) => !t.done);
    if (!turn) return;
    // Everything before it must be over too.
    for (const t of this.turns) {
      if (t === turn) break;
      if (!t.done) this.finish(t, now, false);
    }
    this.finish(turn, now, true);
  }

  /** Per-frame RMS of the host's audio (0..1). */
  noteLevel(level: number, now: number): void {
    this.levelSamples += 1;
    if (level > this.opts.audibleLevel) this.lastAudibleAt = now;
  }

  // ---- Clock ----

  /** Advance the reveal. Returns true when the snapshot changed. */
  tick(now: number): boolean {
    const before = this.version;
    const dt =
      this.lastTickAt === null
        ? 0
        : Math.min(this.opts.maxTickMs, Math.max(0, now - this.lastTickAt));
    this.lastTickAt = now;

    const turn = this.turns.find((t) => !t.done);
    if (!turn) return false;

    const audible = now - this.lastAudibleAt <= this.opts.audibleHoldMs;
    if (!turn.started) {
      const fallback = now - turn.firstDeltaAt >= this.opts.startFallbackMs;
      if (audible || fallback) this.start(turn, now);
      else return false;
    }

    // Without any level samples (no analyser) pace on the wall clock.
    const factor =
      audible || this.levelSamples === 0 ? 1 : this.opts.silentClockFactor;
    turn.clockMs += dt * factor;
    this.reveal(turn, Math.floor(turn.clockMs * this.rate));
    return this.version !== before;
  }

  // ---- Output ----

  snapshot(): PacedCaption[] {
    if (this.snapshotVersion === this.version) return this.snapshotCache;
    this.snapshotCache = this.turns.map((t) => ({
      id: t.id,
      text: t.buffered.slice(0, t.revealed),
      final: t.finalized && t.done && t.revealed >= t.buffered.length,
    }));
    this.snapshotVersion = this.version;
    return this.snapshotCache;
  }

  // ---- Internals ----

  private newTurn(now: number, responseId?: string): Turn {
    const turn: Turn = {
      id: this.opts.makeId(),
      responseId,
      buffered: "",
      revealed: 0,
      finalized: false,
      started: false,
      done: false,
      firstDeltaAt: now,
      clockMs: 0,
    };
    this.turns.push(turn);
    const pending = this.pendingStart;
    if (
      pending &&
      (!pending.responseId || !responseId || pending.responseId === responseId)
    ) {
      this.pendingStart = null;
      this.start(turn, now);
    }
    return turn;
  }

  private findByResponse(responseId: string): Turn | undefined {
    for (let i = this.turns.length - 1; i >= 0; i--) {
      if (this.turns[i].responseId === responseId) return this.turns[i];
    }
    return undefined;
  }

  private start(turn: Turn, now: number): void {
    if (turn.started) return;
    turn.started = true;
    // The first word shows the moment the voice starts.
    this.lastTickAt = now;
    this.reveal(turn, 0);
  }

  private finish(turn: Turn, now: number, calibrate: boolean): void {
    if (turn.done) return;
    if (calibrate && turn.started) this.calibrate(turn, now);
    turn.done = true;
    if (turn.revealed < turn.buffered.length) {
      turn.revealed = turn.buffered.length;
    }
    this.bump();
  }

  /** Re-estimate the speaking rate from a completed turn. */
  private calibrate(turn: Turn, now: number): void {
    // Count the tail that played since the last tick.
    const audible = now - this.lastAudibleAt <= this.opts.audibleHoldMs;
    if (this.lastTickAt !== null) {
      const dt = Math.min(this.opts.maxTickMs, Math.max(0, now - this.lastTickAt));
      turn.clockMs += dt * (audible || this.levelSamples === 0 ? 1 : this.opts.silentClockFactor);
    }
    const chars = turn.buffered.length;
    if (turn.clockMs < 1500 || chars < 40) return;
    const observed = chars / turn.clockMs; // chars per ms
    // Trust the first measurement a lot (the initial rate is a guess), then
    // keep following the voice without over-reacting to one short turn.
    const alpha = this.calibrations === 0 ? 0.8 : 0.5;
    const next = this.rate * (1 - alpha) + observed * alpha;
    const min = this.opts.minCharsPerSecond / 1000;
    const max = this.opts.maxCharsPerSecond / 1000;
    this.rate = Math.min(max, Math.max(min, next));
    this.calibrations += 1;
  }

  /**
   * Reveal up to the end of the word that contains `budget` (the word being
   * spoken now), never a partial word of an unfinished buffer, never
   * backwards.
   */
  private reveal(turn: Turn, budget: number): void {
    const text = turn.buffered;
    if (text.length === 0) return;
    let target: number;
    if (budget >= text.length) {
      target = text.length;
    } else {
      const end = nextBoundary(text, budget);
      if (end < 0) {
        // Inside the last word of a still-streaming buffer: wait for it to
        // complete (deltas can split words).
        if (!turn.finalized) return;
        target = text.length;
      } else {
        target = end;
      }
    }
    if (target > turn.revealed) {
      turn.revealed = target;
      this.bump();
    }
  }

  private bump(): void {
    this.version += 1;
  }
}

/** Index of the first whitespace at or after `from`, or -1. */
function nextBoundary(text: string, from: number): number {
  for (let i = Math.max(0, from); i < text.length; i++) {
    if (isSpace(text.charCodeAt(i))) return i;
  }
  return -1;
}

function isSpace(code: number): boolean {
  return code === 32 || code === 10 || code === 13 || code === 9 || code === 0xa0;
}

/** Starting speaking-rate guess per UI language, characters per second. */
export function defaultCharsPerSecond(locale: string): number {
  // Hebrew is written without vowels, so fewer characters per spoken second.
  return locale.startsWith("he") ? 12 : 15;
}
