/**
 * Browser-side adapter for the OpenAI Realtime API (GA, WebRTC).
 *
 * Responsibilities:
 * - SDP exchange with /v1/realtime/calls using an ephemeral client secret.
 * - Local microphone track + remote audio track wiring.
 * - Data-channel event stream parsing.
 * - Function-call buffering -> single `onToolCall` callback per call.
 * - Streaming transcript deltas for live captions.
 * - WebAudio AnalyserNode-driven audio levels (RMS) for both sides so the UI
 *   can render real "who is talking now" affordances.
 *
 * The adapter is intentionally framework-agnostic; the React room subscribes
 * via callbacks. Tool routing (e.g., progressing the question index) lives
 * upstream in the FSM.
 */

const OPENAI_REALTIME_URL = "https://api.openai.com/v1/realtime/calls";

export interface RealtimeToolCall {
  name: string;
  args: Record<string, unknown>;
  callId: string;
}

export interface OpenAIRealtimeCallbacks {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: Error) => void;
  onUserSpeechStart?: () => void;
  onUserSpeechStop?: () => void;
  onAssistantAudioStart?: () => void;
  onAssistantAudioEnd?: () => void;
  /** Final assistant text item (after audio finishes). */
  onAssistantMessageDone?: (text: string) => void;
  /** Final user input transcript item (after server VAD commit). */
  onUserMessageDone?: (text: string) => void;
  /** Streaming chunk of the assistant's spoken text. */
  onAssistantTranscriptDelta?: (text: string) => void;
  /** Streaming chunk of the user's transcribed speech. */
  onUserTranscriptDelta?: (text: string) => void;
  /** Final committed user transcript (per item). */
  onUserTranscriptDone?: (text: string) => void;
  /** Final committed assistant transcript (per item). */
  onAssistantTranscriptDone?: (text: string) => void;
  /** Tool/function call dispatched by the model (call once arguments are complete). */
  onToolCall?: (call: RealtimeToolCall) => void;
  /** Per-RAF RMS [0,1] of the assistant audio. */
  onAssistantAudioLevel?: (level: number) => void;
  /** Per-RAF RMS [0,1] of the local mic. */
  onUserAudioLevel?: (level: number) => void;
  /** Raw event passthrough for debugging / future phases. */
  onRawEvent?: (event: RealtimeServerEvent) => void;
}

export interface OpenAIRealtimeConnectOptions {
  clientSecret: string;
  model: string;
  audioElement: HTMLAudioElement;
  microphoneStream: MediaStream;
}

interface RealtimeContentPart {
  type?: string;
  text?: string;
  transcript?: string;
}

interface RealtimeItem {
  id?: string;
  role?: "user" | "assistant" | "system";
  type?: string;
  content?: RealtimeContentPart[];
  /** Function call items. */
  name?: string;
  arguments?: string;
  call_id?: string;
}

export interface RealtimeServerEvent {
  type: string;
  event_id?: string;
  item?: RealtimeItem;
  item_id?: string;
  output_index?: number;
  transcript?: string;
  delta?: string;
  name?: string;
  arguments?: string;
  call_id?: string;
  [k: string]: unknown;
}

interface PendingFunctionCall {
  name?: string;
  callId?: string;
  args: string;
}

export class OpenAIRealtimeAdapter {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private callbacks: OpenAIRealtimeCallbacks;
  private assistantAudioActive = false;
  // Tracks whether the server currently has an active response for this
  // session. We flip it true on `response.created`, false on
  // `response.done` / `response.cancelled` / a server-side cancellation
  // error. Used by `cancelActiveResponse()` to avoid sending stray
  // `response.cancel` events that the server rejects with
  // "no active response found".
  private responseActive = false;

  private pendingCalls = new Map<string, PendingFunctionCall>();

  private audioCtx: AudioContext | null = null;
  private hostAnalyser: AnalyserNode | null = null;
  private hostAnalyserSrc: MediaStreamAudioSourceNode | null = null;
  private userAnalyser: AnalyserNode | null = null;
  private userAnalyserSrc: MediaStreamAudioSourceNode | null = null;
  private rafHandle: number | null = null;

  constructor(callbacks: OpenAIRealtimeCallbacks = {}) {
    this.callbacks = callbacks;
  }

  async connect(opts: OpenAIRealtimeConnectOptions): Promise<void> {
    const { clientSecret, model, audioElement, microphoneStream } = opts;
    if (this.pc) {
      throw new Error("openai_adapter_already_connected");
    }

    const pc = new RTCPeerConnection();
    this.pc = pc;
    this.localStream = microphoneStream;

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        audioElement.srcObject = stream;
        audioElement.autoplay = true;
        void audioElement.play().catch(() => {
          /* autoplay may be blocked until user gesture; ignore */
        });
        this.attachAssistantAnalyser(stream);
      }
    };

    for (const track of microphoneStream.getAudioTracks()) {
      pc.addTrack(track, microphoneStream);
    }
    this.attachUserAnalyser(microphoneStream);

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.addEventListener("open", () => this.callbacks.onOpen?.());
    dc.addEventListener("close", () => this.callbacks.onClose?.());
    dc.addEventListener("error", () => {
      this.callbacks.onError?.(new Error("data_channel_error"));
    });
    dc.addEventListener("message", (e) => this.handleEventMessage(e));

    pc.addEventListener("connectionstatechange", () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        this.callbacks.onError?.(
          new Error(`peer_connection_${pc.connectionState}`),
        );
      }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpResponse = await fetch(
      `${OPENAI_REALTIME_URL}?model=${encodeURIComponent(model)}`,
      {
        method: "POST",
        body: offer.sdp ?? "",
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
      },
    );

    if (!sdpResponse.ok) {
      const text = await sdpResponse.text().catch(() => "");
      throw new Error(
        `openai_sdp_${sdpResponse.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      );
    }

    const answerSdp = await sdpResponse.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
  }

  /** Send any GA client event over the data channel. */
  sendEvent(event: Record<string, unknown>): void {
    if (!this.dc || this.dc.readyState !== "open") {
      throw new Error("data_channel_not_open");
    }
    this.dc.send(JSON.stringify(event));
  }

  /** Ask the model to begin its first response (e.g., right after the data channel opens). */
  requestResponse(): void {
    this.sendEvent({ type: "response.create" });
  }

  /**
   * Cancel an in-flight response only if the server thinks one is active.
   * Sending `response.cancel` when no response is in flight produces a
   * server `error` event ("Cancellation failed: no active response found")
   * which we'd otherwise have to filter at the call site.
   */
  cancelActiveResponse(): void {
    if (!this.responseActive) return;
    try {
      this.sendEvent({ type: "response.cancel" });
    } catch {
      /* data channel race; ignore */
    }
  }

  /**
   * Reply to a function/tool call. Sends the function_call_output and then
   * asks the model to produce its next response (so it can keep speaking).
   *
   * `followUpInstructions` is critical when the previous response was forced
   * to call a tool via locked `tool_choice`. In that case the model emits
   * only the function call and the response ends — no audio. Without an
   * explicit follow-up nudge here, the next response.create lands with no
   * instructions, and the session-level prompt actively tells the host to
   * stay silent unless the system handed over a new question. The result is
   * a "dead" interview where the tool call lands but the host never speaks.
   * Pass per-response instructions here to break the silence (e.g. "now
   * speak this question aloud").
   */
  respondToTool(
    callId: string,
    output: unknown,
    options?: { followUpInstructions?: string; createResponse?: boolean },
  ): void {
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify(output ?? {}),
      },
    });
    // Default: ask the model for its next response. For terminal tools
    // like `finish_interview` the caller passes createResponse:false so
    // we don't trigger one more host utterance after the goodbye.
    const shouldCreate = options?.createResponse !== false;
    if (!shouldCreate) return;
    const trimmed = options?.followUpInstructions?.trim();
    if (trimmed) {
      this.sendEvent({
        type: "response.create",
        response: { instructions: trimmed },
      });
    } else {
      this.sendEvent({ type: "response.create" });
    }
  }

  /**
   * Inject a user-side text message and ask the model to respond. Useful for
   * the "Repeat question" / "I'm not sure" buttons which simulate the
   * student saying something without going through audio.
   */
  sendUserText(text: string): void {
    if (!text.trim()) return;
    this.sendEvent({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.sendEvent({ type: "response.create" });
  }

  /** Toggle the local mic track. Returns the new enabled state. */
  setMicEnabled(enabled: boolean): boolean {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track) return false;
    track.enabled = enabled;
    return track.enabled;
  }

  isMicEnabled(): boolean {
    return this.localStream?.getAudioTracks()[0]?.enabled ?? false;
  }

  /**
   * True between `response.created` and `response.done`. A `response.create`
   * sent while this is true is rejected by the server (and the adapter
   * suppresses that error), so callers that must get a response wait for
   * this to clear first.
   */
  isResponseActive(): boolean {
    return this.responseActive;
  }

  disconnect(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    try {
      this.hostAnalyserSrc?.disconnect();
    } catch {
      /* noop */
    }
    try {
      this.userAnalyserSrc?.disconnect();
    } catch {
      /* noop */
    }
    try {
      this.audioCtx?.close();
    } catch {
      /* noop */
    }
    this.audioCtx = null;
    this.hostAnalyser = null;
    this.userAnalyser = null;
    this.hostAnalyserSrc = null;
    this.userAnalyserSrc = null;

    try {
      this.dc?.close();
    } catch {
      /* noop */
    }
    try {
      this.pc?.close();
    } catch {
      /* noop */
    }
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.dc = null;
    this.pc = null;
    this.localStream = null;
    this.pendingCalls.clear();
    this.responseActive = false;
    this.assistantAudioActive = false;
  }

  private ensureAudioCtx(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.audioCtx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      this.audioCtx = new Ctor();
    }
    return this.audioCtx;
  }

  private attachAssistantAnalyser(stream: MediaStream): void {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    try {
      this.hostAnalyserSrc?.disconnect();
    } catch {
      /* noop */
    }
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    this.hostAnalyser = analyser;
    this.hostAnalyserSrc = src;
    this.startLevelLoop();
  }

  private attachUserAnalyser(stream: MediaStream): void {
    const ctx = this.ensureAudioCtx();
    if (!ctx) return;
    try {
      this.userAnalyserSrc?.disconnect();
    } catch {
      /* noop */
    }
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.6;
    src.connect(analyser);
    this.userAnalyser = analyser;
    this.userAnalyserSrc = src;
    this.startLevelLoop();
  }

  private startLevelLoop(): void {
    if (this.rafHandle !== null) return;
    if (typeof window === "undefined") return;

    const hostBuf = new Uint8Array(
      this.hostAnalyser?.frequencyBinCount ?? 256,
    );
    const userBuf = new Uint8Array(
      this.userAnalyser?.frequencyBinCount ?? 256,
    );

    const tick = () => {
      if (this.hostAnalyser && this.callbacks.onAssistantAudioLevel) {
        const buf =
          hostBuf.length === this.hostAnalyser.frequencyBinCount
            ? hostBuf
            : new Uint8Array(this.hostAnalyser.frequencyBinCount);
        this.hostAnalyser.getByteTimeDomainData(buf);
        this.callbacks.onAssistantAudioLevel(rms(buf));
      }
      if (this.userAnalyser && this.callbacks.onUserAudioLevel) {
        const buf =
          userBuf.length === this.userAnalyser.frequencyBinCount
            ? userBuf
            : new Uint8Array(this.userAnalyser.frequencyBinCount);
        this.userAnalyser.getByteTimeDomainData(buf);
        this.callbacks.onUserAudioLevel(rms(buf));
      }
      this.rafHandle = requestAnimationFrame(tick);
    };
    this.rafHandle = requestAnimationFrame(tick);
  }

  private handleEventMessage(e: MessageEvent<string>): void {
    let event: RealtimeServerEvent | null = null;
    try {
      event = JSON.parse(e.data) as RealtimeServerEvent;
    } catch {
      this.callbacks.onError?.(new Error("invalid_server_event_json"));
      return;
    }
    if (!event) return;
    this.callbacks.onRawEvent?.(event);

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.callbacks.onUserSpeechStart?.();
        break;
      case "input_audio_buffer.speech_stopped":
        this.callbacks.onUserSpeechStop?.();
        break;
      case "response.created": {
        // Some realtime sessions don't emit `response.done` /
        // `response.output_audio.done` reliably between consecutive
        // model responses. `response.created` is guaranteed at the
        // start of every new response, so we use it as a hard reset
        // for the audio-active gate. Without this, `assistantAudioActive`
        // can stay stuck on `true`, which prevents `onAssistantAudioStart`
        // from re-firing for subsequent turns and breaks the upstream
        // watchdog / counter logic.
        this.responseActive = true;
        if (this.assistantAudioActive) {
          this.assistantAudioActive = false;
          this.callbacks.onAssistantAudioEnd?.();
        }
        break;
      }
      case "response.output_audio.delta":
        if (!this.assistantAudioActive) {
          this.assistantAudioActive = true;
          this.callbacks.onAssistantAudioStart?.();
        }
        break;
      case "response.output_audio.done":
      case "response.done":
      case "response.cancelled":
        this.responseActive = false;
        if (this.assistantAudioActive) {
          this.assistantAudioActive = false;
          this.callbacks.onAssistantAudioEnd?.();
        }
        break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (delta) this.callbacks.onAssistantTranscriptDelta?.(delta);
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done": {
        const text =
          typeof event.transcript === "string"
            ? event.transcript
            : typeof (event as { text?: string }).text === "string"
              ? (event as { text?: string }).text!
              : "";
        if (text) this.callbacks.onAssistantTranscriptDone?.(text);
        break;
      }
      case "conversation.item.input_audio_transcription.delta": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (delta) this.callbacks.onUserTranscriptDelta?.(delta);
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const text =
          typeof event.transcript === "string" ? event.transcript : "";
        if (text) this.callbacks.onUserTranscriptDone?.(text);
        break;
      }
      case "response.output_item.added": {
        const item = event.item;
        if (item?.type === "function_call") {
          // Later `.delta` / `.done` events look the call up by item_id only,
          // so an entry without one could never be matched.
          const id = item.id ?? event.item_id;
          if (!id) break;
          this.pendingCalls.set(id, {
            name: item.name,
            callId: item.call_id,
            args: item.arguments ?? "",
          });
        }
        break;
      }
      case "response.function_call_arguments.delta": {
        const id = event.item_id ?? "";
        if (!id) break;
        const entry =
          this.pendingCalls.get(id) ??
          (() => {
            const e: PendingFunctionCall = { args: "" };
            this.pendingCalls.set(id, e);
            return e;
          })();
        const delta = typeof event.delta === "string" ? event.delta : "";
        entry.args += delta;
        if (event.name && !entry.name) entry.name = event.name;
        if (event.call_id && !entry.callId) entry.callId = event.call_id;
        break;
      }
      case "response.function_call_arguments.done": {
        const id = event.item_id ?? "";
        const entry = id ? this.pendingCalls.get(id) : undefined;
        const finalName =
          entry?.name ?? (typeof event.name === "string" ? event.name : "");
        const finalCallId =
          entry?.callId ??
          (typeof event.call_id === "string" ? event.call_id : "");
        const argText =
          (entry?.args ?? "") +
          (typeof event.arguments === "string" ? event.arguments : "");
        if (id) this.pendingCalls.delete(id);
        if (!finalName || !finalCallId) break;
        let parsed: Record<string, unknown> = {};
        try {
          parsed = argText ? (JSON.parse(argText) as Record<string, unknown>) : {};
        } catch {
          parsed = {};
        }
        this.callbacks.onToolCall?.({
          name: finalName,
          args: parsed,
          callId: finalCallId,
        });
        break;
      }
      case "conversation.item.done": {
        const item = event.item;
        if (!item) break;
        if (item.type === "function_call") {
          // Already handled via the dedicated function-call events above.
          break;
        }
        const text = extractItemText(item);
        if (!text) break;
        if (item.role === "assistant") {
          this.callbacks.onAssistantMessageDone?.(text);
        } else if (item.role === "user") {
          this.callbacks.onUserMessageDone?.(text);
        }
        break;
      }
      case "conversation.item.input_audio_transcription.failed": {
        // The server tried to transcribe a committed user audio buffer
        // and failed (noise, very short clip, transcription model
        // hiccup). Surface as a delta-level callback so the UI can show
        // a "didn't catch that" placeholder without crashing the
        // session. We deliberately do NOT route this through onError —
        // a transcription miss is recoverable; the next user turn will
        // try again.
        const errInfo = (event as {
          error?: { code?: string; type?: string; message?: string };
        }).error;
        // Best-effort breadcrumb in dev so we can spot recurring
        // transcription failures (no PII because there's no transcript).
        if (typeof console !== "undefined") {
          console.warn(
            "[openai-realtime] input audio transcription failed",
            errInfo,
          );
        }
        break;
      }
      case "error": {
        const errInfo = (event as {
          error?: { code?: string; type?: string; message?: string };
        }).error;
        const code = errInfo?.code ?? "";
        const message = errInfo?.message ?? "openai_realtime_error";
        // Filter benign errors that the server emits as full `error`
        // events but are operationally fine:
        //   - "Cancellation failed: no active response found" — happens
        //     when we preemptively call `response.cancel` and there is
        //     no response in flight (cancelActiveResponse already guards
        //     against this; the filter is defense-in-depth for races
        //     where the server cleared the response between our state
        //     update and the cancel send).
        //   - "Conversation already has an active response in progress"
        //     — happens when we send a `response.create` while one is
        //     still being produced (e.g., StrictMode re-runs in dev,
        //     onOpen firing twice during a reconnect, or a race with
        //     server VAD's auto-create). The server already has an
        //     active response so the host will speak anyway; treating
        //     this as a fatal connection error would tear down the
        //     working session for nothing.
        if (
          code === "response_cancel_not_active" ||
          /no active response/i.test(message)
        ) {
          this.responseActive = false;
          break;
        }
        if (
          code === "conversation_already_has_active_response" ||
          /already has an active response/i.test(message)
        ) {
          this.responseActive = true;
          if (typeof console !== "undefined") {
            console.warn(
              "[openai-realtime] suppressed benign error:",
              message,
            );
          }
          break;
        }
        this.callbacks.onError?.(new Error(message));
        break;
      }
      default:
        break;
    }
  }
}

function extractItemText(item: RealtimeItem): string {
  const parts = item.content ?? [];
  const buf: string[] = [];
  for (const p of parts) {
    if (typeof p.text === "string" && p.text.length) buf.push(p.text);
    else if (typeof p.transcript === "string" && p.transcript.length)
      buf.push(p.transcript);
  }
  return buf.join(" ").trim();
}

function rms(buf: Uint8Array): number {
  if (buf.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = (buf[i] - 128) / 128;
    sum += v * v;
  }
  return Math.min(1, Math.sqrt(sum / buf.length));
}
