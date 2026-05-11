"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "@/lib/i18n/navigation";
import { Blobs } from "@/components/podtask/blobs";
import { Badge, Chip } from "@/components/podtask/chip";
import { BrandMark } from "@/components/podtask/brand-mark";
import { Eyebrow } from "@/components/podtask/eyebrow";
import { GlowOrb } from "@/components/podtask/glow-orb";
import { MicButton } from "@/components/podtask/mic-button";
import { Waveform } from "@/components/podtask/waveform";
import {
  ArrowIcon,
  MicIcon,
  MicOffIcon,
  PauseIcon,
  PlayIcon,
  SparkIcon,
  XIcon,
} from "@/components/podtask/icons";
import { MOCK_INTERVIEW_QUESTIONS } from "@/lib/student/mock-data";
import { formatTime } from "@/lib/utils";
import {
  useInterviewSession,
  type InterviewAdapterMode,
} from "@/lib/realtime/interview-session";
import {
  OpenAIRealtimeAdapter,
  type RealtimeToolCall,
} from "@/lib/realtime/openai-adapter";
import { createRealtimeSession } from "@/lib/realtime/realtime-client";
import type { StudentInterviewQuestion } from "@/lib/student/types";

const ADAPTER_MODE: InterviewAdapterMode =
  process.env.NEXT_PUBLIC_REALTIME_ADAPTER === "openai" ? "openai" : "mock";

const UUID_RE = /^[0-9a-f-]{36}$/i;

// UI-only "is the speaker actually talking" threshold for the halo / chip.
// The server's VAD (turn_detection) is the authoritative gate for actually
// committing audio — this constant only drives the visual indicator.
const SPEECH_LEVEL_THRESHOLD = 0.07;
const INTERVIEW_QUESTION_COUNT = 5;

interface TurnEntry {
  id: string;
  text: string;
  final: boolean;
}

interface InterviewRoomClientProps {
  interviewId: string;
  assignmentTitle: string;
  questions: StudentInterviewQuestion[];
  locale: string;
}

function makeTurnId(): string {
  return `t_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export function InterviewRoomClient({
  interviewId,
  assignmentTitle,
  questions: initialQuestions,
  locale,
}: InterviewRoomClientProps) {
  const t = useTranslations();
  const router = useRouter();
  const questions = useMemo(
    () =>
      initialQuestions.length > 0
        ? initialQuestions
        : (MOCK_INTERVIEW_QUESTIONS as StudentInterviewQuestion[]),
    [initialQuestions],
  );
  const cappedQuestions = useMemo(
    () => questions.slice(0, INTERVIEW_QUESTION_COUNT),
    [questions],
  );

  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [adapterError, setAdapterError] = useState<string | null>(null);

  const adapterMode: InterviewAdapterMode =
    ADAPTER_MODE === "openai" && UUID_RE.test(interviewId) ? "openai" : "mock";

  const session = useInterviewSession({
    interviewId,
    questions: cappedQuestions,
    mode: adapterMode,
    onCompleted: () => {
      router.push(`/student/interviews/${interviewId}/complete`);
    },
  });

  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  });

  const adapterRef = useRef<OpenAIRealtimeAdapter | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const [hostLevel, setHostLevel] = useState(0);
  const [userLevel, setUserLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  // Fallback close logic: if the model forgets to call `finish_interview`
  // after the final planned question, we still close automatically after the
  // student provides an answer to that last question, so report generation
  // is always triggered.
  const askedQuestionIndexesRef = useRef<Set<number>>(new Set());
  const lastDetectedQuestionIndexRef = useRef(-1);
  const waitingForFinalAnswerRef = useRef(false);
  const finalAnswerHandledRef = useRef(false);
  // Belt-and-suspenders close logic: once the host emits a strong closing
  // utterance (e.g. "הראיון הסתיים" / "the interview is over"), we arm a
  // watchdog and close as soon as the host stops speaking, even if the
  // model never calls `finish_interview` and the per-question fingerprinter
  // missed the last planned question.
  const studentAnswerCountRef = useRef(0);
  const closingHitsRef = useRef(0);
  const pendingCloseRef = useRef(false);
  const closingTimerRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);
  // Tracks whether the host audio stream is currently playing. We need
  // this so that `finish_interview` can wait for the farewell sentence to
  // finish instead of cutting it off mid-word when the model calls the
  // tool while it's still speaking.
  const hostSpeakingRef = useRef(false);

  useEffect(() => {
    askedQuestionIndexesRef.current = new Set();
    lastDetectedQuestionIndexRef.current = -1;
    waitingForFinalAnswerRef.current = false;
    finalAnswerHandledRef.current = false;
    studentAnswerCountRef.current = 0;
    closingHitsRef.current = 0;
    pendingCloseRef.current = false;
    if (closingTimerRef.current !== null) {
      window.clearTimeout(closingTimerRef.current);
      closingTimerRef.current = null;
    }
  }, [interviewId]);

  // Single rolling transcript for both sides. Each entry is one "turn"
  // (one continuous stream of speech from one speaker). When delta events
  // arrive we append to the trailing turn for that speaker, or start a
  // new turn if the speaker changed or the previous turn was finalized.
  const [transcript, setTranscript] = useState<TurnEntry[]>([]);

  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const appendTranscriptDelta = useCallback(
    (delta: string) => {
      if (!delta) return;
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        if (last && !last.final) {
          const updated: TurnEntry = { ...last, text: last.text + delta };
          return [...prev.slice(0, -1), updated];
        }
        return [...prev, { id: makeTurnId(), text: delta, final: false }];
      });
    },
    [],
  );

  // Arms the closing watchdog. Idempotent — repeated calls don't re-stack
  // timers. Uses a 3 s ceiling because the host's audio_end fires within
  // ~1.5 s of the last word in practice; the timer is just a safety net
  // for the rare case where audio_end is dropped/delayed.
  const scheduleAutoClose = useCallback(() => {
    if (finalAnswerHandledRef.current) return;
    if (pendingCloseRef.current) return;
    pendingCloseRef.current = true;
    if (closingTimerRef.current !== null) {
      window.clearTimeout(closingTimerRef.current);
    }
    closingTimerRef.current = window.setTimeout(() => {
      closingTimerRef.current = null;
      if (finalAnswerHandledRef.current) return;
      finalAnswerHandledRef.current = true;
      sessionRef.current.close();
    }, 3000);
  }, []);

  const finalizeTranscript = useCallback(
    (finalText: string) => {
      setTranscript((prev) => {
        const last = prev[prev.length - 1];
        // Case 1: there's a live (un-finalized) host entry — promote it
        // to final, preferring the freshly-supplied text.
        if (last && !last.final) {
          const updated: TurnEntry = {
            ...last,
            text: finalText || last.text,
            final: true,
          };
          return [...prev.slice(0, -1), updated];
        }
        if (!finalText) return prev;
        // Case 2: duplicate final host entry.
        if (last && last.final && last.text.trim() === finalText.trim()) {
          return prev;
        }
        // Case 3: a normal new final entry.
        return [...prev, { id: makeTurnId(), text: finalText, final: true }];
      });
    },
    [],
  );

  // Mock driver: kick the FSM as soon as the room mounts.
  useEffect(() => {
    if (adapterMode !== "mock") return;
    sessionRef.current.connect();
    const onConnected = setTimeout(
      () => sessionRef.current.confirmConnected(),
      200,
    );
    return () => clearTimeout(onConnected);
  }, [adapterMode]);

  // OpenAI live adapter wiring — flowing-conversation model.
  //
  // Architecture: the host already has the full planned-question list in
  // its system prompt (see realtime-instructions.ts). The model owns
  // pacing — it walks through questions on its own, follows up where it
  // wants to dig, and calls `finish_interview` when the conversation is
  // done (or when the student verbally asks to wrap up).
  //
  // The browser's only jobs are:
  //   1. Open the WebRTC data channel.
  //   2. Send a single `response.create` to make the host speak first
  //      (the warm welcome + first question).
  //   3. Stream both sides of the transcript to screen + persist them.
  //   4. Forward the `finish_interview` tool call to close the session.
  useEffect(() => {
    if (adapterMode !== "openai") return;

    let cancelled = false;
    let micStream: MediaStream | null = null;

    sessionRef.current.connect();

    (async () => {
      try {
        const token = await createRealtimeSession(interviewId);
        if (cancelled) return;

        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          micStream.getTracks().forEach((tk) => tk.stop());
          return;
        }

        const audioEl = audioRef.current;
        if (!audioEl) throw new Error("audio_element_missing");

        // Guard against onOpen firing more than once for the same
        // adapter instance (defensive: WebRTC data-channel reconnects
        // can re-fire `open`, and React StrictMode re-runs effects in
        // dev). Without this we sometimes send a second `response.create`
        // while the first response is still streaming, and the server
        // responds with "Conversation already has an active response in
        // progress" — surfaced to the user as a network error.
        let kickedOff = false;

        const adapter = new OpenAIRealtimeAdapter({
          onOpen: () => {
            sessionRef.current.confirmConnected();
            if (kickedOff) return;
            kickedOff = true;
            // Kick the host: the session prompt tells it exactly what to
            // do for the opening (warm welcome + first question), so a
            // bare response.create is enough. cancelActiveResponse() is a
            // no-op when nothing is in flight, but if a stale response
            // somehow exists it clears the way first.
            try {
              adapter.cancelActiveResponse();
              adapter.sendEvent({ type: "response.create" });
            } catch {
              /* data channel may be racing; the next user audio will trigger anyway */
            }
          },
          onClose: () => {
            const s = sessionRef.current;
            if (s.state !== "completed" && s.state !== "closing") {
              s.fail("data_channel_closed");
            }
          },
          onError: (err) => {
            setAdapterError(err.message);
            sessionRef.current.fail(err.message);
          },
          onAssistantAudioStart: () => {
            hostSpeakingRef.current = true;
            sessionRef.current.aiStartedSpeaking();
          },
          onAssistantAudioEnd: () => {
            hostSpeakingRef.current = false;
            sessionRef.current.aiFinishedSpeaking();
            // If a closing line was detected during this turn, close as
            // soon as the host actually falls silent rather than waiting
            // the full 3 s watchdog.
            if (pendingCloseRef.current && !finalAnswerHandledRef.current) {
              finalAnswerHandledRef.current = true;
              if (closingTimerRef.current !== null) {
                window.clearTimeout(closingTimerRef.current);
                closingTimerRef.current = null;
              }
              sessionRef.current.close();
            }
          },
          onUserSpeechStart: () => {
            sessionRef.current.startRecording();
          },
          onUserSpeechStop: () => {
            sessionRef.current.finishRecording(undefined, { persist: false });
          },
          onAssistantMessageDone: (text) => {
            if (text) {
              // Defensive: if `response.audio_transcript.done` didn't
              // fire (older models / partial event coverage), the host
              // text still lands here via `conversation.item.done`. The
              // dedupe inside finalizeTranscript handles the common
              // case where both events fire with the same text.
              finalizeTranscript(text);
              sessionRef.current.persistAssistantMessage(text);
              const total = cappedQuestions.length;
              // Priority order:
              //  1. Explicit ordinal/numeric announcement from the host
              //     ("אנחנו בשאלה השלישית" / "We're on the fifth question").
              //     This is the contract we now ask the model to follow,
              //     so when it fires it's very high confidence.
              //  2. Fuzzy text overlap with the planned question wording.
              //  3. "Next question" linguistic cue + monotonic increment.
              const explicitIdx = detectExplicitQuestionNumber(text, locale);
              let resolvedIdx = explicitIdx;
              if (resolvedIdx < 0) {
                resolvedIdx = detectPlannedQuestionIndex(
                  text,
                  cappedQuestions,
                  locale,
                );
              }
              if (
                resolvedIdx < 0 &&
                total > 0 &&
                looksLikePlannedQuestionTransition(text, locale) &&
                lastDetectedQuestionIndexRef.current < total - 1
              ) {
                // Fallback progression for strong "next question" transitions
                // when the model paraphrases too far from the original text.
                resolvedIdx = lastDetectedQuestionIndexRef.current + 1;
              }
              if (resolvedIdx >= 0 && total > 0) {
                const clampedIdx = Math.max(0, Math.min(total - 1, resolvedIdx));
                askedQuestionIndexesRef.current.add(clampedIdx);
                lastDetectedQuestionIndexRef.current = Math.max(
                  lastDetectedQuestionIndexRef.current,
                  clampedIdx,
                );
                if (
                  clampedIdx >= total - 1 ||
                  askedQuestionIndexesRef.current.size >= total
                ) {
                  waitingForFinalAnswerRef.current = true;
                }
              }
              // Belt-and-suspenders safety net for the case where the
              // model emits a clear closing sentence but never calls the
              // `finish_interview` tool. The previous version of this
              // gate also required `askedQuestionIndexesRef` to contain
              // the last planned question, which fails whenever the
              // fuzzy fingerprinter misses an aggressive paraphrase —
              // and with that gate failing, the page sits stuck on the
              // live screen even though the host clearly said goodbye.
              //
              // We now arm the close on any *strong* closing utterance,
              // provided one of these confidence signals holds:
              //   - At least one student answer has already been
              //     committed (so it's not a premature greeting).
              //   - We've seen the closing pattern more than once.
              //   - Enough wall-clock time has elapsed (≥ 45 s) that
              //     this is almost certainly the real ending.
              if (
                !finalAnswerHandledRef.current &&
                looksLikeInterviewClosing(text, locale)
              ) {
                closingHitsRef.current += 1;
                const meaningfulConversation =
                  studentAnswerCountRef.current >= 1;
                const repeatedClosing = closingHitsRef.current >= 2;
                const enoughTime = elapsedRef.current >= 45;
                if (meaningfulConversation || repeatedClosing || enoughTime) {
                  scheduleAutoClose();
                }
              }
            }
          },
          onUserMessageDone: (text) => {
            if (text) {
              sessionRef.current.persistStudentMessage(text);
              if (text.trim().length > 2) {
                studentAnswerCountRef.current += 1;
              }
              if (
                waitingForFinalAnswerRef.current &&
                !finalAnswerHandledRef.current &&
                text.trim().length > 2
              ) {
                finalAnswerHandledRef.current = true;
                sessionRef.current.close();
              }
            }
          },
          onAssistantTranscriptDelta: (delta) => {
            appendTranscriptDelta(delta);
          },
          onAssistantTranscriptDone: (text) => {
            finalizeTranscript(text);
          },
          onUserTranscriptDone: (text) => {
            if (text) {
              sessionRef.current.persistStudentMessage(text);
              if (text.trim().length > 2) {
                studentAnswerCountRef.current += 1;
              }
              if (
                waitingForFinalAnswerRef.current &&
                !finalAnswerHandledRef.current &&
                text.trim().length > 2
              ) {
                finalAnswerHandledRef.current = true;
                sessionRef.current.close();
              }
            }
          },
          onAssistantAudioLevel: setHostLevel,
          onUserAudioLevel: setUserLevel,
          onToolCall: (call: RealtimeToolCall) => {
            if (call.name === "finish_interview") {
              try {
                // createResponse:false — the host already said its
                // goodbye line just before calling the tool; we don't
                // want it to spin up another response after we close.
                adapter.respondToTool(
                  call.callId,
                  { ok: true },
                  { createResponse: false },
                );
              } catch {
                /* noop */
              }
              // Wait for the farewell audio to finish before closing.
              // The model may call `finish_interview` while it is still
              // mid-sentence on the goodbye line — closing the session
              // immediately would cut the audio off mid-word and the
              // student would never hear the farewell.
              //
              // Strategy:
              //   - If the host is still speaking, mark the close as
              //     pending. `onAssistantAudioEnd` will then trigger the
              //     real close as soon as the host falls silent.
              //   - If the host is already silent (i.e. it finished the
              //     farewell before emitting the tool call), close after
              //     a short grace so the audio element flushes any
              //     buffered samples.
              //   - In either case, arm a safety timer (10 s) so a
              //     dropped `audio_end` event never strands the user on
              //     the live screen.
              if (finalAnswerHandledRef.current) return;
              if (closingTimerRef.current !== null) {
                window.clearTimeout(closingTimerRef.current);
                closingTimerRef.current = null;
              }
              pendingCloseRef.current = true;
              if (hostSpeakingRef.current) {
                closingTimerRef.current = window.setTimeout(() => {
                  closingTimerRef.current = null;
                  if (finalAnswerHandledRef.current) return;
                  finalAnswerHandledRef.current = true;
                  sessionRef.current.close();
                }, 10_000);
              } else {
                closingTimerRef.current = window.setTimeout(() => {
                  closingTimerRef.current = null;
                  if (finalAnswerHandledRef.current) return;
                  finalAnswerHandledRef.current = true;
                  sessionRef.current.close();
                }, 600);
              }
            } else if (call.name === "ask_question_at_index") {
              try {
                // Legacy compatibility no-op. We do NOT drive question
                // progression from tools anymore, but replying OK avoids
                // model-side "tool failed" narratives that can surface as
                // user-facing "technical issue" apologies.
                adapter.respondToTool(call.callId, { ok: true });
                const raw =
                  typeof call.args.index === "number"
                    ? call.args.index
                    : Number(call.args.index ?? -1);
                if (Number.isFinite(raw)) {
                  const idx = Math.max(
                    0,
                    Math.min(cappedQuestions.length - 1, Math.floor(raw)),
                  );
                  askedQuestionIndexesRef.current.add(idx);
                  if (idx >= cappedQuestions.length - 1) {
                    waitingForFinalAnswerRef.current = true;
                  }
                }
              } catch {
                /* noop */
              }
            } else {
              try {
                // Be forgiving for unknown tool names: return success so
                // the model keeps the interview flowing instead of
                // inventing a technical-failure explanation to the user.
                adapter.respondToTool(call.callId, { ok: true });
              } catch {
                /* noop */
              }
            }
          },
        });

        adapterRef.current = adapter;

        await adapter.connect({
          clientSecret: token.clientSecret,
          model: token.model,
          audioElement: audioEl,
          microphoneStream: micStream,
        });
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "realtime_connect_failed";
        setAdapterError(message);
        sessionRef.current.fail(message);
        micStream?.getTracks().forEach((tk) => tk.stop());
      }
    })();

    return () => {
      cancelled = true;
      adapterRef.current?.disconnect();
      adapterRef.current = null;
      micStream?.getTracks().forEach((tk) => tk.stop());
      if (closingTimerRef.current !== null) {
        window.clearTimeout(closingTimerRef.current);
        closingTimerRef.current = null;
      }
    };
  }, [
    adapterMode,
    interviewId,
    appendTranscriptDelta,
    finalizeTranscript,
    scheduleAutoClose,
    cappedQuestions,
    locale,
  ]);

  useEffect(() => {
    if (paused) return;
    if (session.state === "completed" || session.state === "closing") return;
    const tid = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(tid);
  }, [paused, session.state]);

  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  // Once the FSM has actually transitioned out of the "live" phase, the
  // watchdog has nothing left to do. Keep this effect cheap; it just frees
  // the timer so an unmount doesn't fire a stale close().
  useEffect(() => {
    if (session.state !== "closing" && session.state !== "completed") return;
    if (closingTimerRef.current !== null) {
      window.clearTimeout(closingTimerRef.current);
      closingTimerRef.current = null;
    }
  }, [session.state]);

  function toggleMute() {
    const adapter = adapterRef.current;
    if (!adapter) return;
    const nextEnabled = !adapter.isMicEnabled();
    const result = adapter.setMicEnabled(nextEnabled);
    setMuted(!result);
  }

  // Spacebar mute toggle for live mode.
  useEffect(() => {
    if (adapterMode !== "openai") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      const adapter = adapterRef.current;
      if (!adapter) return;
      const nextEnabled = !adapter.isMicEnabled();
      const result = adapter.setMicEnabled(nextEnabled);
      setMuted(!result);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adapterMode]);

  const aiSpeaking =
    session.state === "host_intro" || session.state === "ai_speaking";
  const recording = session.state === "student_recording";
  const processing =
    session.state === "transcribing" || session.state === "evaluating_answer";
  const closingOrDone =
    session.state === "closing" || session.state === "completed";

  const hostActive =
    adapterMode === "openai"
      ? hostLevel > SPEECH_LEVEL_THRESHOLD
      : aiSpeaking;
  const userActive =
    adapterMode === "openai"
      ? userLevel > SPEECH_LEVEL_THRESHOLD && !muted
      : recording;

  // Smoothed "host is speaking" signal for the transcript glow — see
  // the original implementation: avoids strobing on syllable gaps.
  const [hostGlow, setHostGlow] = useState(false);
  useEffect(() => {
    if (hostActive) {
      setHostGlow(true);
      return;
    }
    const id = window.setTimeout(() => setHostGlow(false), 320);
    return () => window.clearTimeout(id);
  }, [hostActive]);

  function handleEndEarly() {
    session.close();
  }

  // Mock-mode primary CTA still drives the FSM. Live mode uses the
  // bottom dock buttons (mute / end) — there's no per-question button
  // anymore.
  function handleMockPrimary() {
    if (adapterMode === "openai") return;
    if (session.state === "student_turn") {
      session.startRecording();
      return;
    }
    if (session.state === "student_recording") {
      session.finishRecording();
      return;
    }
    if (session.state === "followup") {
      if (session.questionIndex >= cappedQuestions.length - 1) {
        session.close();
      } else {
        session.nextQuestion();
      }
    }
  }

  const primaryLabel =
    session.state === "student_turn"
      ? t("interview.startAnswer")
      : session.state === "student_recording"
        ? t("interview.finishAnswer")
        : session.questionIndex === cappedQuestions.length - 1
          ? t("interview.finishInterview")
          : t("interview.nextQuestion");

  const halo = makeHalo(hostLevel, userLevel);

  return (
    <div className="screen" style={{ minHeight: "100vh", position: "relative" }}>
      <Blobs variant="studio" />

      <header className="topbar" style={{ padding: "14px 32px" }}>
        <div className="row" style={{ gap: 12 }}>
          <BrandMark size={32} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>
              {t("interview.live")}
            </div>
            <div
              className="text-muted"
              style={{ fontSize: 11, fontWeight: 600 }}
            >
              {assignmentTitle}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 12 }}>
          <Badge variant="pink">
            <span
              className="dot"
              style={{
                background: "#FB7185",
                boxShadow: "0 0 8px #FB7185",
              }}
            />
            {t("interview.recordingTime", { time: formatTime(elapsed) })}
          </Badge>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: "8px 14px", fontSize: 13 }}
            onClick={handleEndEarly}
          >
            {t("interview.endEarly")}
          </button>
        </div>
      </header>

      <div
        style={{
          maxWidth: 1100,
          margin: "0 auto",
          padding: "32px 32px 220px",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
            isolation: "isolate",
            paddingBottom: 8,
          }}
        >
          {/* HOST CARD */}
          <motion.div
            className="card-hero"
            animate={{
              boxShadow: hostActive
                ? `0 24px 60px rgba(15,23,42,0.08), 0 0 ${12 + halo.host}px rgba(56,189,248,0.32), inset 0 1px 0 rgba(255,255,255,0.9)`
                : "0 22px 60px rgba(15,23,42,0.07), inset 0 1px 0 rgba(255,255,255,0.9)",
              borderColor: hostActive
                ? "rgba(56,189,248,0.7)"
                : "rgba(230,238,247,0.9)",
            }}
            transition={{ duration: 0.18 }}
            style={{
              padding: 32,
              position: "relative",
              overflow: "hidden",
              height: 240,
              border: "1.5px solid rgba(230,238,247,0.9)",
            }}
          >
            <div
              style={{
                minHeight: 32,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Eyebrow icon={<SparkIcon size={14} />}>
                {t("interview.aiHost")}
              </Eyebrow>
            </div>
            <div
              className="row"
              style={{ gap: 16, marginTop: 24, alignItems: "center" }}
            >
              <GlowOrb
                size={96}
                spinDuration={hostActive ? 4 : 12}
                float={hostActive}
              />
              <div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {t("lobby.hostName")}
                </div>
                <div
                  className="text-muted"
                  style={{ fontSize: 13, marginTop: 2 }}
                >
                  {t("interview.podcastHost")}
                </div>
                <div
                  style={{
                    marginTop: 16,
                    height: 40,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {hostActive ? (
                    <Waveform />
                  ) : (
                    <span className="text-muted" style={{ fontSize: 12 }}>
                      {session.state === "connecting"
                        ? t("interview.connecting")
                        : t("interview.hostTurn")}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </motion.div>

          {/* STUDENT CARD */}
          <motion.div
            className="card"
            animate={{
              boxShadow: userActive
                ? `0 24px 60px rgba(15,23,42,0.08), 0 0 ${12 + halo.user}px rgba(251,113,133,0.32), inset 0 1px 0 rgba(255,255,255,0.9)`
                : "0 22px 60px rgba(15,23,42,0.06), inset 0 1px 0 rgba(255,255,255,0.9)",
              borderColor: userActive
                ? "rgba(251,113,133,0.7)"
                : "rgba(230,238,247,0.9)",
            }}
            transition={{ duration: 0.18 }}
            style={{
              padding: 32,
              position: "relative",
              overflow: "hidden",
              height: 240,
              border: "1.5px solid rgba(230,238,247,0.9)",
            }}
          >
            <div
              style={{
                minHeight: 32,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Eyebrow showDot>{t("interview.you")}</Eyebrow>
            </div>
            <div
              style={{
                position: "absolute",
                top: 32,
                insetInlineEnd: 32,
                display: "flex",
                alignItems: "center",
              }}
            >
              {muted ? (
                <Chip>
                  <MicOffIcon size={12} /> {t("interview.muted")}
                </Chip>
              ) : userActive ? (
                <Chip variant="pink">
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "rgb(var(--pink-deep))",
                      display: "inline-block",
                      boxShadow: "0 0 6px rgb(var(--pink-deep))",
                    }}
                  />
                  {t("interview.yourTurn")}
                </Chip>
              ) : (
                <Chip>{t("interview.waiting")}</Chip>
              )}
            </div>
            <div
              className="row"
              style={{ gap: 16, marginTop: 24, alignItems: "center" }}
            >
              <div
                style={{
                  width: 96,
                  height: 96,
                  borderRadius: "50%",
                  background: "linear-gradient(135deg, #FDA4AF, #7DD3FC)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "white",
                  fontWeight: 800,
                  fontSize: 32,
                  boxShadow: "0 12px 30px rgba(14,165,233,0.2)",
                }}
              >
                {t("dashboard.greeting", { name: "מ" }).slice(3, 4) || "מ"}
              </div>
              <div>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                  }}
                >
                  {t("interview.youName")}
                </div>
                <div
                  className="text-muted"
                  style={{ fontSize: 13, marginTop: 2 }}
                >
                  {muted
                    ? t("interview.muted")
                    : userActive
                      ? t("interview.shareThoughts")
                      : t("interview.takeYourTime")}
                </div>
                <div
                  style={{
                    marginTop: 16,
                    height: 40,
                    display: "flex",
                    alignItems: "center",
                  }}
                >
                  {userActive && !muted ? (
                    <Waveform variant="pink" />
                  ) : (
                    <LevelBar level={muted ? 0 : userLevel} variant="pink" />
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* LIVE TRANSCRIPT — replaces the old per-question card. Renders
            both sides of the conversation in chronological order, with a
            soft glow when the host is currently speaking. Auto-scrolls
            to the latest line. */}
        {adapterMode === "openai" ? (
          <motion.div
            className="card"
            animate={{
              boxShadow: hostGlow
                ? "0 30px 80px rgba(15,23,42,0.08), 0 0 28px rgba(244,114,182,0.28), inset 0 1px 0 rgba(255,255,255,0.9)"
                : "0 30px 80px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.9)",
            }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            style={{
              marginTop: 64,
              padding: "28px 32px",
              borderRadius: 28,
              position: "relative",
              zIndex: 2,
              background: "rgba(255,255,255,0.96)",
              border: "1px solid rgba(226,232,240,0.9)",
            }}
            dir={locale === "he" ? "rtl" : "ltr"}
          >
            <div
              className="between"
              style={{ marginBottom: 18, alignItems: "center" }}
            >
              <Eyebrow icon={<SparkIcon size={14} />}>
                {t("interview.liveTranscript")}
              </Eyebrow>
              <span
                className="text-muted"
                style={{ fontSize: 12, fontWeight: 600 }}
              >
                {t("interview.thinkAloud")}
              </span>
            </div>

            <div
              ref={transcriptScrollRef}
              style={{
                maxHeight: 420,
                minHeight: 220,
                overflowY: "auto",
                display: "flex",
                flexDirection: "column",
                gap: 14,
                paddingInlineEnd: 4,
                scrollBehavior: "smooth",
              }}
            >
              {transcript.length === 0 ? (
                <div
                  className="text-muted"
                  style={{
                    fontSize: 14,
                    fontWeight: 500,
                    paddingBlock: 24,
                    textAlign: "center",
                  }}
                >
                  {session.state === "connecting"
                    ? t("interview.connecting")
                    : t("interview.hostTurn")}
                </div>
              ) : (
                transcript.map((entry) => (
                  <TranscriptBubble
                    key={entry.id}
                    text={entry.text}
                    isLive={!entry.final}
                    hostLabel={t("interview.aiHost")}
                  />
                ))
              )}
            </div>
          </motion.div>
        ) : null}
      </div>

      {/* BOTTOM DOCK */}
      <div
        style={{
          position: "fixed",
          bottom: 0,
          insetInlineStart: 0,
          insetInlineEnd: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            maxWidth: 1100,
            margin: "0 auto",
            padding: "20px 32px 28px",
          }}
        >
          <div
            className="card"
            style={{
              padding: "16px 20px",
              borderRadius: 28,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "rgba(255,255,255,0.94)",
              backdropFilter: "blur(8px)",
            }}
          >
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: "12px 16px", fontSize: 13 }}
                onClick={() => setPaused((p) => !p)}
              >
                {paused ? (
                  <>
                    <PlayIcon /> {t("interview.resume")}
                  </>
                ) : (
                  <>
                    <PauseIcon /> {t("interview.pause")}
                  </>
                )}
              </button>
            </div>

            <div className="row" style={{ gap: 16, alignItems: "center" }}>
              {adapterMode === "openai" ? (
                <>
                  <div
                    className="text-muted"
                    style={{ fontSize: 12, fontWeight: 600 }}
                  >
                    {muted
                      ? t("interview.spaceToUnmute")
                      : t("interview.spaceToMute")}
                  </div>
                  <button
                    type="button"
                    onClick={toggleMute}
                    aria-label={
                      muted ? t("interview.unmute") : t("interview.mute")
                    }
                    aria-pressed={muted}
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: "50%",
                      border: "none",
                      cursor: "pointer",
                      background: muted
                        ? "linear-gradient(135deg,#94A3B8,#475569)"
                        : "linear-gradient(135deg,#FDA4AF,#F43F5E)",
                      color: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: muted
                        ? "0 8px 22px rgba(71,85,105,0.35)"
                        : "0 12px 28px rgba(244,63,94,0.35)",
                      transition: "transform .15s ease",
                    }}
                  >
                    {muted ? <MicOffIcon size={26} /> : <MicIcon size={26} />}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{
                      padding: "14px 22px",
                      fontSize: 14,
                      borderColor: "rgba(244,63,94,0.4)",
                      color: "#9F1239",
                    }}
                    onClick={handleEndEarly}
                  >
                    <XIcon size={14} /> {t("interview.endInterviewShort")}
                  </button>
                </>
              ) : (
                <>
                  <MicButton
                    recording={recording}
                    size={72}
                    onClick={() => {
                      if (session.state === "student_turn") {
                        session.startRecording();
                      } else if (session.state === "student_recording") {
                        session.finishRecording();
                      }
                    }}
                    ariaLabel={t("interview.recording")}
                    disabled={
                      session.state !== "student_turn" &&
                      session.state !== "student_recording"
                    }
                  >
                    {recording ? (
                      <div
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: 4,
                          background: "white",
                        }}
                      />
                    ) : (
                      <MicIcon size={26} />
                    )}
                  </MicButton>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: "14px 22px", fontSize: 14 }}
                    onClick={handleMockPrimary}
                    disabled={aiSpeaking || processing}
                  >
                    {primaryLabel}
                    <span className="icon-flip">
                      <ArrowIcon />
                    </span>
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <audio ref={audioRef} hidden playsInline />

      {adapterError && (
        <div
          role="alert"
          style={{
            position: "fixed",
            top: 80,
            insetInlineEnd: 32,
            background: "rgba(255,228,230,0.95)",
            border: "1px solid rgba(244,63,94,0.4)",
            color: "#9F1239",
            padding: "10px 14px",
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 600,
            maxWidth: 320,
            boxShadow: "0 12px 30px rgba(244,63,94,0.18)",
            zIndex: 20,
          }}
        >
          {t("interview.connectionError")}: {adapterError}
        </div>
      )}

      <AnimatePresence>
        {closingOrDone ? (
          <motion.div
            key="wrap-up"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 50,
              background: "rgba(15,23,42,0.45)",
              backdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <motion.div
              initial={{ scale: 0.96, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="card"
              style={{
                padding: "32px 40px",
                borderRadius: 24,
                background: "rgba(255,255,255,0.98)",
                display: "flex",
                alignItems: "center",
                gap: 18,
                boxShadow: "0 30px 80px rgba(15,23,42,0.25)",
              }}
            >
              <Spinner />
              <div>
                <div style={{ fontSize: 18, fontWeight: 800 }}>
                  {t("interview.wrappingUp")}
                </div>
                <div className="text-muted" style={{ fontSize: 13 }}>
                  {t("complete.scoringHint")}
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function TranscriptBubble({
  text,
  isLive,
  hostLabel,
}: {
  text: string;
  isLive: boolean;
  hostLabel: string;
}) {
  const accentColor = "#0EA5E9";
  const bubbleBg = "rgba(14,165,233,0.06)";
  const bubbleBorder = "rgba(14,165,233,0.18)";
  const labelBg = "rgba(14,165,233,0.10)";
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        columnGap: 12,
        alignItems: "start",
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: accentColor,
          padding: "4px 10px",
          borderRadius: 999,
          background: labelBg,
          whiteSpace: "nowrap",
          alignSelf: "start",
          marginTop: 4,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {hostLabel}
        {isLive ? (
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: accentColor,
              boxShadow: `0 0 6px ${accentColor}`,
              animation: "pulse 1.1s ease-in-out infinite",
            }}
          />
        ) : null}
      </div>
      <div
        style={{
          fontSize: 16,
          lineHeight: 1.6,
          fontWeight: 500,
          color: "rgb(var(--ink))",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          padding: "10px 14px",
          borderRadius: 14,
          background: bubbleBg,
          border: `1px solid ${bubbleBorder}`,
        }}
      >
        {text || "…"}
      </div>
    </div>
  );
}

function makeHalo(hostLevel: number, userLevel: number) {
  return {
    host: Math.min(Math.round(hostLevel * 70), 70),
    user: Math.min(Math.round(userLevel * 70), 70),
  };
}

function LevelBar({
  level,
  variant,
}: {
  level: number;
  variant: "cyan" | "pink";
}) {
  const fill = Math.min(1, Math.max(0, level * 4));
  const color = variant === "pink" ? "#FB7185" : "#38BDF8";
  return (
    <div
      aria-hidden
      style={{
        width: 120,
        height: 4,
        borderRadius: 2,
        background: "rgba(148,163,184,0.18)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          width: `${fill * 100}%`,
          height: "100%",
          background: color,
          transition: "width .12s linear",
        }}
      />
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        border: "3px solid rgba(56,189,248,0.25)",
        borderTopColor: "#38BDF8",
        display: "inline-block",
        animation: "spin 0.9s linear infinite",
      }}
    />
  );
}

// High-confidence detector: looks for explicit ordinal/number markers
// in the host's announcement, e.g. "אנחנו בשאלה השלישית" or
// "We're on the fifth and final question". The host is now instructed
// to prefix every NEW planned question with such an announcement, so
// when this fires it's much more reliable than fuzzy text matching.
//
// Returns the 0-based question index, or -1 when no marker is found.
function detectExplicitQuestionNumber(
  text: string,
  locale: string,
): number {
  if (!text) return -1;
  if (locale === "he") {
    const HE_ORDINALS: Array<[string, number]> = [
      ["ראשונה", 0],
      ["שנייה", 1],
      ["שניה", 1],
      ["שלישית", 2],
      ["רביעית", 3],
      ["חמישית", 4],
      ["שישית", 5],
      ["שביעית", 6],
      ["שמינית", 7],
      ["תשיעית", 8],
      ["עשירית", 9],
    ];
    for (const [word, ordinal] of HE_ORDINALS) {
      if (
        text.includes(`שאלה ה${word}`) ||
        text.includes(`שאלה ${word}`) ||
        text.includes(`השאלה ה${word}`)
      ) {
        return ordinal;
      }
    }
    const numMatch = text.match(/שאלה\s+(?:מספר\s+)?(\d{1,2})\b/);
    if (numMatch) {
      const n = Number.parseInt(numMatch[1], 10);
      if (Number.isFinite(n) && n >= 1) return n - 1;
    }
    return -1;
  }
  const lower = text.toLowerCase();
  const EN_ORDINALS: Array<[string, number]> = [
    ["first", 0],
    ["second", 1],
    ["third", 2],
    ["fourth", 3],
    ["fifth", 4],
    ["sixth", 5],
    ["seventh", 6],
    ["eighth", 7],
    ["ninth", 8],
    ["tenth", 9],
  ];
  for (const [word, ordinal] of EN_ORDINALS) {
    if (
      new RegExp(
        `\\b${word}\\s+(?:and\\s+(?:final|last)\\s+)?question\\b`,
      ).test(lower) ||
      new RegExp(`\\bquestion\\s+(?:number\\s+)?${word}\\b`).test(lower)
    ) {
      return ordinal;
    }
  }
  const numMatch = lower.match(/\bquestion\s+(?:number\s+)?(\d{1,2})\b/);
  if (numMatch) {
    const n = Number.parseInt(numMatch[1], 10);
    if (Number.isFinite(n) && n >= 1) return n - 1;
  }
  return -1;
}

function detectPlannedQuestionIndex(
  assistantText: string,
  questions: StudentInterviewQuestion[],
  locale: string,
): number {
  const hay = normalizeForMatch(assistantText);
  if (!hay) return -1;
  let bestIndex = -1;
  let bestScore = 0;
  // Match against known question texts from the plan.
  // We score each question and pick the strongest candidate.
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const he = normalizeForMatch(q.question);
    const en = normalizeForMatch(
      locale === "en"
        ? ((q as { questionEn?: string }).questionEn ?? "")
        : ((q as { questionEn?: string }).questionEn ?? ""),
    );
    const topic = normalizeForMatch(q.topic ?? "");
    let score = 0;
    if (he.length >= 8 && (hay.includes(he) || he.includes(hay))) score = 1;
    if (en.length >= 8 && (hay.includes(en) || en.includes(hay))) score = 1;
    score = Math.max(score, tokenOverlap(hay, he), tokenOverlap(hay, en));
    if (topic.length >= 4) score = Math.max(score, tokenOverlap(hay, topic) * 0.75);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  }
  // Conservative floor for fuzzy matches to avoid random false positives.
  return bestScore >= 0.33 ? bestIndex : -1;
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/["'`“”״]/g, "")
    .replace(/[.,!?;:()[\]{}\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  if (!a || !b) return 0;
  const aTokens = new Set(a.split(" ").filter((t) => t.length >= 3));
  const bTokens = new Set(b.split(" ").filter((t) => t.length >= 3));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let common = 0;
  for (const t of bTokens) {
    if (aTokens.has(t)) common += 1;
  }
  return common / bTokens.size;
}

function looksLikeInterviewClosing(text: string, locale: string): boolean {
  const normalized = normalizeForMatch(text);
  if (!normalized) return false;
  // Phrase set is intentionally broad — false positives here are cheap
  // (the gates in the caller require additional evidence before closing)
  // while false negatives strand the student on the live screen forever.
  const heSignals = [
    "הראיון הסתיים",
    "הראיון נגמר",
    "סיימנו את הראיון",
    "סיימנו",
    "נסיים כאן",
    "נסיים את הראיון",
    "נעצור כאן",
    "תודה רבה",
    "תודה שהשתתפת",
    "תודה שהשתתפתם",
    "להתראות",
    "יום טוב",
    "המשך יום טוב",
    "המשך יום נעים",
    "בהצלחה בהמשך",
    "בהצלחה",
  ];
  const enSignals = [
    "the interview is over",
    "the interview is done",
    "the interview has ended",
    "we'll wrap up here",
    "let's wrap up",
    "let's stop here",
    "we'll stop here",
    "thank you for joining",
    "thanks for joining",
    "thanks for sharing",
    "goodbye",
    "have a good day",
    "have a great day",
    "good luck",
    "we're done",
    "we are done",
  ];
  const signals = locale === "he" ? heSignals : enSignals;
  return signals.some((sig) => normalized.includes(normalizeForMatch(sig)));
}

function looksLikePlannedQuestionTransition(text: string, locale: string): boolean {
  const normalized = normalizeForMatch(text);
  if (!normalized) return false;
  const heSignals = [
    "השאלה הבאה",
    "נעבור לשאלה הבאה",
    "בואי נעבור לשאלה הבאה",
    "בוא נמשיך לשאלה הבאה",
    "נעבור לנושא הבא",
    "בואי נמשיך",
    "בוא נמשיך",
  ];
  const enSignals = [
    "next question",
    "let's move to the next question",
    "shall we move to the next question",
    "let's move on",
    "let's turn to",
    "moving to the next topic",
  ];
  const signals = locale === "he" ? heSignals : enSignals;
  return signals.some((sig) => normalized.includes(normalizeForMatch(sig)));
}
