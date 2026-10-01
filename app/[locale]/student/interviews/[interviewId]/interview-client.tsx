"use client";

/**
 * Live interview room — one component, two drivers.
 *
 * MODE. `adapterMode` is "openai" only when NEXT_PUBLIC_REALTIME_ADAPTER=openai
 * AND the interview id is a real UUID; demo ids always run the "mock" driver
 * (timer-driven FSM in `useInterviewSession`). The two driver effects, and the
 * spacebar mute shortcut, are mutually exclusive on `adapterMode`.
 *
 * LIVE DRIVER. Opens a WebRTC session via `OpenAIRealtimeAdapter`; the host
 * already has the full planned-question list in its system prompt and owns
 * the pacing. The browser only (1) kicks off the first response, (2) streams
 * the host transcript to screen + persists both sides, (3) infers question
 * progress from the host's words (`host-text-heuristics.ts`), and (4) closes.
 *
 * CLOSE PATHS. Every path ends in `closeNow()` (idempotent), and none of them
 * cuts the host off: the room guarantees a spoken farewell first.
 *   a. `finish_interview` tool call → `beginFarewell("tool")`: if the host's
 *      last utterance already was a goodbye, wait for its audio to end; if
 *      not, ask the host for an explicit goodbye and close when it is spoken.
 *   b. Closing-phrase detection on the host transcript: a strong "the
 *      interview is over" line ends it at any time; a likely goodbye
 *      (thanks + wish) only once the last planned question was answered.
 *   c. Final-answer watchdog: after the last answer the host gets ~75 s to
 *      wrap up on its own, then `beginFarewell("watchdog")` asks for it.
 *   d. "End interview" button → `beginFarewell("student_end")`.
 * `close()` moves the FSM to `closing` → `onCompleted` → router.push(/complete).
 *
 * SKIP / SWAP. The student can skip a question (recorded as a system
 * message, lowers the score) or swap one question once; both are sent to
 * the host as bracketed system notes inside a user text message.
 *
 * PAUSE only pauses the on-screen timer; the live session keeps running.
 */

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
  RepeatIcon,
  SparkIcon,
  XIcon,
} from "@/components/podtask/icons";
import { MOCK_INTERVIEW_QUESTIONS } from "@/lib/student/mock-data";
import { REALTIME_ADAPTER } from "@/lib/env";
import {
  buildFarewellInstructions,
  buildReplaceDirective,
  buildSkipDirective,
  type FarewellReason,
} from "@/lib/realtime/host-directives";
import { useHeldTrue } from "@/lib/hooks/use-held-true";
import { formatTime, isUuidLike } from "@/lib/utils";
import {
  useInterviewSession,
  type InterviewAdapterMode,
} from "@/lib/realtime/interview-session";
import {
  OpenAIRealtimeAdapter,
  type RealtimeToolCall,
} from "@/lib/realtime/openai-adapter";
import { createRealtimeSession } from "@/lib/realtime/realtime-client";
import {
  closingStrength,
  detectExplicitQuestionNumber,
  detectPlannedQuestionIndex,
  looksLikePlannedQuestionTransition,
} from "@/lib/realtime/host-text-heuristics";
import type { StudentInterviewQuestion } from "@/lib/student/types";
import { LevelBar, Spinner, TranscriptBubble, makeHalo } from "./interview-parts";

// ---- Section: build/mode config ----

// UI-only "is the speaker actually talking" threshold for the halo / chip.
// The server's VAD (turn_detection) is the authoritative gate for actually
// committing audio — this constant only drives the visual indicator.
const SPEECH_LEVEL_THRESHOLD = 0.07;
const INTERVIEW_QUESTION_COUNT = 5;

// Closing timings (ms) — see the "closing" section inside the component.
const FAREWELL_GRACE_MS = 1200; // let the last audio frames play out
const FAREWELL_NO_AUDIO_MS = 8000; // a requested goodbye never started
const FAREWELL_SAFETY_MS = 25_000; // hard ceiling on any goodbye
const FINAL_ANSWER_WATCHDOG_MS = 75_000; // last answer given, host never wrapped up
const FINAL_ANSWER_WATCHDOG_SHORT_MS = 45_000; // after skipping the last question

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
  /** Shown on the student card; falls back to a generic label. */
  studentName?: string;
  studentInitial?: string;
}

function makeTurnId(): string {
  return `t_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

export function InterviewRoomClient({
  interviewId,
  assignmentTitle,
  questions: initialQuestions,
  locale,
  studentName,
  studentInitial,
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
    REALTIME_ADAPTER === "openai" && isUuidLike(interviewId) ? "openai" : "mock";

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
  // Skip / swap controls (see confirmSkip / confirmReplace).
  const [banner, setBanner] = useState<"skip" | "replace" | null>(null);
  const [replaceUsed, setReplaceUsed] = useState(false);
  // True from the moment the room decided to end until the FSM closes: the
  // host is saying (or being asked to say) goodbye.
  const [wrappingUp, setWrappingUp] = useState(false);

  // Question-progress tracking. The host announces each planned question
  // with an ordinal; we mirror that into `lastDetectedQuestionIndexRef` (and
  // the FSM) so persisted messages bind to the right plan question and the
  // skip / swap controls know which question is on the table.
  const askedQuestionIndexesRef = useRef<Set<number>>(new Set());
  const lastDetectedQuestionIndexRef = useRef(-1);
  const waitingForFinalAnswerRef = useRef(false);
  // Set once the student answered (or skipped) the last planned question.
  // From here a likely farewell from the host is enough to end, and the
  // watchdog asks for a goodbye if the host never gives one.
  const finalAnswerGivenRef = useRef(false);
  const finalAnswerWatchdogRef = useRef<number | null>(null);
  // Flipped exactly once, by closeNow(). Every close path checks it.
  const finalAnswerHandledRef = useRef(false);
  const studentAnswerCountRef = useRef(0);
  const lastAssistantTextRef = useRef("");
  // pendingClose = "close as soon as the host falls silent";
  // closingTimer = grace / safety timer for that pending close.
  const pendingCloseRef = useRef(false);
  const closingTimerRef = useRef<number | null>(null);
  // Browser-driven farewell bookkeeping (see beginFarewell).
  const farewellRef = useRef({
    started: false,
    sendWhenSilent: false,
    pendingReason: "tool" as FarewellReason,
    sent: false,
    audioStarted: false,
    timers: [] as number[],
  });
  // Whether host audio is currently playing, so every close path can wait
  // for the goodbye to finish instead of cutting it off.
  const hostSpeakingRef = useRef(false);

  useEffect(() => {
    askedQuestionIndexesRef.current = new Set();
    lastDetectedQuestionIndexRef.current = -1;
    waitingForFinalAnswerRef.current = false;
    finalAnswerGivenRef.current = false;
    finalAnswerHandledRef.current = false;
    studentAnswerCountRef.current = 0;
    lastAssistantTextRef.current = "";
    pendingCloseRef.current = false;
    farewellRef.current = {
      started: false,
      sendWhenSilent: false,
      pendingReason: "tool",
      sent: false,
      audioStarted: false,
      timers: [],
    };
    if (closingTimerRef.current !== null) {
      window.clearTimeout(closingTimerRef.current);
      closingTimerRef.current = null;
    }
    if (finalAnswerWatchdogRef.current !== null) {
      window.clearTimeout(finalAnswerWatchdogRef.current);
      finalAnswerWatchdogRef.current = null;
    }
  }, [interviewId]);

  // ---- Section: transcript buffer ----

  // Rolling on-screen transcript of the HOST's speech (student answers are
  // persisted to the DB but not rendered). Each entry is one "turn": delta
  // events append to the trailing un-finalized turn, and a new turn starts
  // once the previous one was finalized.
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

  // ---- Section: closing (every path ends in closeNow) ----

  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  const clearClosingTimers = useCallback(() => {
    if (closingTimerRef.current !== null) {
      window.clearTimeout(closingTimerRef.current);
      closingTimerRef.current = null;
    }
    if (finalAnswerWatchdogRef.current !== null) {
      window.clearTimeout(finalAnswerWatchdogRef.current);
      finalAnswerWatchdogRef.current = null;
    }
    for (const id of farewellRef.current.timers) window.clearTimeout(id);
    farewellRef.current.timers = [];
  }, []);

  // The single exit: idempotent, clears every timer, moves the FSM to
  // `closing` (which redirects to /complete and triggers scoring).
  const closeNow = useCallback(() => {
    if (finalAnswerHandledRef.current) return;
    finalAnswerHandledRef.current = true;
    clearClosingTimers();
    sessionRef.current.close();
  }, [clearClosingTimers]);

  // Close once the host has finished its current utterance. If audio is
  // playing, `onAssistantAudioEnd` re-enters here with the host silent; a
  // safety timer guarantees we never strand the student if that event is
  // lost. When the host is already silent a short grace timer closes.
  const closeAfterHostSilent = useCallback(
    (graceMs: number) => {
      if (finalAnswerHandledRef.current) return;
      pendingCloseRef.current = true;
      if (closingTimerRef.current !== null) {
        window.clearTimeout(closingTimerRef.current);
      }
      closingTimerRef.current = window.setTimeout(
        closeNow,
        hostSpeakingRef.current ? FAREWELL_SAFETY_MS : graceMs,
      );
    },
    [closeNow],
  );

  // Ask the host for an explicit, warm goodbye; the close happens when it
  // has been spoken (onAssistantAudioEnd). Waits for the server to be idle
  // first — a `response.create` sent during an active response is dropped.
  const sendFarewellResponse = useCallback(
    (reason: FarewellReason) => {
      const adapter = adapterRef.current;
      if (!adapter || farewellRef.current.sent) return;
      farewellRef.current.sent = true;
      const instructions = buildFarewellInstructions(localeRef.current, reason);
      const startedAt = Date.now();
      const trySend = () => {
        if (finalAnswerHandledRef.current || adapterRef.current !== adapter) return;
        if (adapter.isResponseActive() && Date.now() - startedAt < 3000) {
          farewellRef.current.timers.push(window.setTimeout(trySend, 120));
          return;
        }
        try {
          adapter.sendEvent({
            type: "response.create",
            response: { instructions },
          });
        } catch {
          closeNow();
          return;
        }
        // No audio within a few seconds → the model isn't going to speak.
        farewellRef.current.timers.push(
          window.setTimeout(() => {
            if (!farewellRef.current.audioStarted) closeNow();
          }, FAREWELL_NO_AUDIO_MS),
        );
        // Hard ceiling on the goodbye itself.
        farewellRef.current.timers.push(
          window.setTimeout(closeNow, FAREWELL_SAFETY_MS),
        );
      };
      trySend();
    },
    [closeNow],
  );

  // Entry point for every "the interview is over" decision in live mode:
  //   tool         — the model called finish_interview
  //   watchdog     — last answer given long ago, host never wrapped up
  //   student_end  — the student pressed "end interview"
  //   skipped_last — the student skipped the final question
  // If the host already said goodbye on its own we only wait for the audio
  // to finish; otherwise we ask it for a proper farewell first.
  const beginFarewell = useCallback(
    (reason: FarewellReason) => {
      if (farewellRef.current.started || finalAnswerHandledRef.current) return;
      farewellRef.current.started = true;
      setWrappingUp(true);
      setBanner(null);
      const adapter = adapterRef.current;
      if (!adapter) {
        closeNow();
        return;
      }
      // Don't let the student's mic interrupt the goodbye (server VAD would
      // cancel the response and auto-create a new one).
      adapter.setMicEnabled(false);
      const strength = closingStrength(lastAssistantTextRef.current, localeRef.current);
      const hostAlreadySaidGoodbye =
        reason === "tool" && (strength === "likely" || strength === "strong");
      if (hostAlreadySaidGoodbye) {
        closeAfterHostSilent(FAREWELL_GRACE_MS);
        return;
      }
      if (hostSpeakingRef.current) {
        // Let the current sentence finish; onAssistantAudioEnd sends it.
        farewellRef.current.sendWhenSilent = true;
        farewellRef.current.pendingReason = reason;
        farewellRef.current.timers.push(
          window.setTimeout(() => {
            if (farewellRef.current.sendWhenSilent) {
              farewellRef.current.sendWhenSilent = false;
              sendFarewellResponse(reason);
            }
          }, FAREWELL_SAFETY_MS),
        );
        return;
      }
      sendFarewellResponse(reason);
    },
    [closeAfterHostSilent, closeNow, sendFarewellResponse],
  );

  // After the last answer the host gets a while to wrap up by itself; if it
  // never does, we ask for the goodbye instead of cutting the session.
  const armFinalAnswerWatchdog = useCallback(
    (delayMs: number) => {
      if (finalAnswerWatchdogRef.current !== null) return;
      finalAnswerWatchdogRef.current = window.setTimeout(() => {
        finalAnswerWatchdogRef.current = null;
        beginFarewell("watchdog");
      }, delayMs);
    },
    [beginFarewell],
  );

  // Inject text as if the student had typed it (skip / swap notes), once
  // the server is idle. Cancels whatever the host is saying first so the
  // reaction is immediate.
  const injectUserText = useCallback((text: string) => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    adapter.cancelActiveResponse();
    const startedAt = Date.now();
    const trySend = () => {
      if (adapterRef.current !== adapter) return;
      if (adapter.isResponseActive() && Date.now() - startedAt < 3000) {
        window.setTimeout(trySend, 120);
        return;
      }
      try {
        adapter.sendUserText(text);
      } catch {
        /* data channel closed; nothing to do */
      }
    };
    trySend();
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

  // ---- Section: drivers (mock FSM / OpenAI WebRTC) ----

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

        // Shared handler for both "final student text" events the adapter
        // emits (conversation item done + input transcription completed).
        // Both events still fire exactly as before; only the body is shared.
        // Which plan question the conversation is on right now (null during
        // the greeting, before the first ordinal announcement).
        const currentPlanQuestionId = (): string | null => {
          const i = lastDetectedQuestionIndexRef.current;
          return i >= 0 ? (cappedQuestions[i]?.id ?? null) : null;
        };

        const handleStudentUtterance = (text: string) => {
          if (!text) return;
          sessionRef.current.persistStudentMessage(text, currentPlanQuestionId());
          if (text.trim().length <= 2) return;
          studentAnswerCountRef.current += 1;
          if (waitingForFinalAnswerRef.current && !finalAnswerGivenRef.current) {
            // The last planned question has been answered. Do NOT close
            // here — the host still has to react and say goodbye. The
            // watchdog asks for the farewell if the model never wraps up.
            finalAnswerGivenRef.current = true;
            armFinalAnswerWatchdog(FINAL_ANSWER_WATCHDOG_MS);
          }
        };

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
            if (farewellRef.current.sent) farewellRef.current.audioStarted = true;
            sessionRef.current.aiStartedSpeaking();
          },
          onAssistantAudioEnd: () => {
            hostSpeakingRef.current = false;
            sessionRef.current.aiFinishedSpeaking();
            const fw = farewellRef.current;
            // The host finished what it was saying; now ask for the goodbye.
            if (fw.sendWhenSilent && !fw.sent) {
              fw.sendWhenSilent = false;
              sendFarewellResponse(fw.pendingReason);
              return;
            }
            // The goodbye we asked for has been spoken.
            if (fw.sent && fw.audioStarted) {
              closeAfterHostSilent(FAREWELL_GRACE_MS);
              return;
            }
            // The host said goodbye on its own and has now fallen silent.
            if (pendingCloseRef.current && !finalAnswerHandledRef.current) {
              closeAfterHostSilent(FAREWELL_GRACE_MS);
            }
          },
          onUserSpeechStart: () => {
            sessionRef.current.startRecording();
          },
          onUserSpeechStop: () => {
            sessionRef.current.finishRecording(undefined, { persist: false });
          },
          onAssistantMessageDone: (text) => {
            if (!text) return;
            const loc = localeRef.current;
            lastAssistantTextRef.current = text;
            // Defensive: if `response.audio_transcript.done` didn't fire
            // (older models / partial event coverage), the host text still
            // lands here via `conversation.item.done`. The dedupe inside
            // finalizeTranscript handles the common case where both events
            // fire with the same text.
            finalizeTranscript(text);
            const total = cappedQuestions.length;
            // Priority order:
            //  1. Explicit ordinal/numeric announcement from the host
            //     ("אנחנו בשאלה השלישית" / "We're on the fifth question").
            //     This is the contract we ask the model to follow, so when
            //     it fires it's very high confidence.
            //  2. Fuzzy text overlap with the planned question wording.
            //  3. "Next question" linguistic cue + monotonic increment.
            const explicitIdx = detectExplicitQuestionNumber(text, loc);
            let resolvedIdx = explicitIdx;
            if (resolvedIdx < 0) {
              resolvedIdx = detectPlannedQuestionIndex(text, cappedQuestions);
            }
            if (
              resolvedIdx < 0 &&
              total > 0 &&
              looksLikePlannedQuestionTransition(text, loc) &&
              lastDetectedQuestionIndexRef.current < total - 1
            ) {
              // Fallback progression for strong "next question" transitions
              // when the model paraphrases too far from the original text.
              resolvedIdx = lastDetectedQuestionIndexRef.current + 1;
            }
            if (resolvedIdx >= 0 && total > 0) {
              const clampedIdx = Math.max(0, Math.min(total - 1, resolvedIdx));
              askedQuestionIndexesRef.current.add(clampedIdx);
              if (clampedIdx > lastDetectedQuestionIndexRef.current) {
                lastDetectedQuestionIndexRef.current = clampedIdx;
                // Keep the FSM in step so the on-screen counter and the
                // skip / swap controls follow the host.
                sessionRef.current.setQuestionIndex(clampedIdx);
              }
              if (
                clampedIdx >= total - 1 ||
                askedQuestionIndexesRef.current.size >= total
              ) {
                waitingForFinalAnswerRef.current = true;
              }
            }
            // Persist AFTER resolving the index so the announcement of
            // question N is bound to question N, not N-1.
            sessionRef.current.persistAssistantMessage(
              text,
              currentPlanQuestionId(),
            );
            // Farewell detection. A strong "the interview is over" line ends
            // the session at any time (after at least one answer, so a
            // greeting can't trip it); a likely goodbye (thanks + wish)
            // only once the last planned question has been answered —
            // the host also thanks the student between questions.
            if (!finalAnswerHandledRef.current && !farewellRef.current.started) {
              const strength = closingStrength(text, loc);
              const strong = strength === "strong" && studentAnswerCountRef.current >= 1;
              const likely = strength === "likely" && finalAnswerGivenRef.current;
              if (strong || likely) {
                farewellRef.current.started = true;
                setWrappingUp(true);
                setBanner(null);
                adapterRef.current?.setMicEnabled(false);
                closeAfterHostSilent(FAREWELL_GRACE_MS);
              }
            }
          },
          onUserMessageDone: handleStudentUtterance,
          onAssistantTranscriptDelta: (delta) => {
            appendTranscriptDelta(delta);
          },
          onAssistantTranscriptDone: (text) => {
            finalizeTranscript(text);
          },
          onUserTranscriptDone: handleStudentUtterance,
          onAssistantAudioLevel: setHostLevel,
          onUserAudioLevel: setUserLevel,
          onToolCall: (call: RealtimeToolCall) => {
            if (call.name === "finish_interview") {
              try {
                // createResponse:false — we decide ourselves whether the
                // host still owes the student a goodbye (beginFarewell).
                adapter.respondToTool(
                  call.callId,
                  { ok: true },
                  { createResponse: false },
                );
              } catch {
                /* noop */
              }
              beginFarewell("tool");
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
        // Tear down the half-built adapter: connect() starts the audio-level
        // RAF loop and AudioContext before the SDP handshake, so a failed
        // handshake would otherwise leave them running until unmount.
        adapterRef.current?.disconnect();
        adapterRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      adapterRef.current?.disconnect();
      adapterRef.current = null;
      micStream?.getTracks().forEach((tk) => tk.stop());
      clearClosingTimers();
    };
  }, [
    adapterMode,
    interviewId,
    appendTranscriptDelta,
    finalizeTranscript,
    beginFarewell,
    sendFarewellResponse,
    closeAfterHostSilent,
    armFinalAnswerWatchdog,
    clearClosingTimers,
    cappedQuestions,
  ]);

  // ---- Section: timers + keyboard shortcuts ----

  const closingOrDone =
    session.state === "closing" || session.state === "completed";

  // Elapsed-time ticker. Keyed on the boolean (not session.state) so the
  // interval survives intermediate FSM transitions instead of restarting
  // and dropping the partial second on every one.
  useEffect(() => {
    if (paused || closingOrDone) return;
    const tid = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(tid);
  }, [paused, closingOrDone]);

  // Once the FSM has transitioned out of the live phase, no timer has
  // anything left to do; free them so an unmount can't fire a stale close().
  useEffect(() => {
    if (session.state !== "closing" && session.state !== "completed") return;
    clearClosingTimers();
  }, [session.state, clearClosingTimers]);

  // Reads the adapter through a ref at call time, so `[]` deps are correct.
  // Ignored during the farewell so the goodbye can't be interrupted.
  const toggleMute = useCallback(() => {
    if (farewellRef.current.started) return;
    const adapter = adapterRef.current;
    if (!adapter) return;
    const nextEnabled = !adapter.isMicEnabled();
    const result = adapter.setMicEnabled(nextEnabled);
    setMuted(!result);
  }, []);

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
      toggleMute();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adapterMode, toggleMute]);

  // ---- Section: derived view state ----

  const aiSpeaking =
    session.state === "host_intro" || session.state === "ai_speaking";
  const recording = session.state === "student_recording";
  const processing =
    session.state === "transcribing" || session.state === "evaluating_answer";

  const hostActive =
    adapterMode === "openai"
      ? hostLevel > SPEECH_LEVEL_THRESHOLD
      : aiSpeaking;
  const userActive =
    adapterMode === "openai"
      ? userLevel > SPEECH_LEVEL_THRESHOLD && !muted
      : recording;

  // Smoothed "host is speaking" signal for the transcript glow — holds true
  // for 320 ms after the level drops so it doesn't strobe on syllable gaps.
  const hostGlow = useHeldTrue(hostActive, 320);

  function handleEndEarly() {
    if (adapterMode === "openai") {
      beginFarewell("student_end");
      return;
    }
    session.close();
  }

  // 1-based number of the question currently on the table (skip / swap UI).
  const currentQuestionNumber = Math.min(
    cappedQuestions.length,
    session.questionIndex + 1,
  );
  const controlsLocked =
    wrappingUp ||
    closingOrDone ||
    session.state === "idle" ||
    session.state === "connecting";

  // Skip: recorded as a system message (the report lowers the score for it)
  // and the host is told to move on without judgement.
  function confirmSkip() {
    setBanner(null);
    if (controlsLocked) return;
    const idx = Math.max(0, session.questionIndex);
    const total = cappedQuestions.length;
    const isLast = idx >= total - 1;
    sessionRef.current.persistSystemMessage(
      `skipped_question:${idx + 1}`,
      cappedQuestions[idx]?.id ?? null,
    );
    askedQuestionIndexesRef.current.add(idx);
    if (adapterMode === "openai") {
      injectUserText(buildSkipDirective(locale, idx + 1, total, isLast));
      if (isLast) {
        waitingForFinalAnswerRef.current = true;
        finalAnswerGivenRef.current = true;
        armFinalAnswerWatchdog(FINAL_ANSWER_WATCHDOG_SHORT_MS);
      } else {
        // Pre-advance; the host's own ordinal announcement (if any) only
        // ever moves the index forward, never back.
        lastDetectedQuestionIndexRef.current = idx + 1;
        session.setQuestionIndex(idx + 1);
      }
      return;
    }
    // Mock driver.
    if (isLast) session.close();
    else session.setQuestionIndex(idx + 1);
  }

  // Swap (once): the host asks a different question in the same slot; no
  // effect on the score.
  function confirmReplace() {
    setBanner(null);
    if (controlsLocked || replaceUsed) return;
    setReplaceUsed(true);
    const idx = Math.max(0, session.questionIndex);
    sessionRef.current.persistSystemMessage(
      `replaced_question:${idx + 1}`,
      cappedQuestions[idx]?.id ?? null,
    );
    if (adapterMode === "openai") {
      injectUserText(buildReplaceDirective(locale, idx + 1));
      return;
    }
    session.setQuestionIndex(idx);
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

  // ---- Section: JSX ----

  return (
    <div className="screen" style={{ minHeight: "100vh", position: "relative" }}>
      <Blobs variant="studio" />

      <header className="topbar topbar-room">
        <div className="row" style={{ gap: 12, minWidth: 0 }}>
          <BrandMark size={32} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 14 }}>
              {t("interview.live")}
            </div>
            <div
              className="text-muted room-title"
              style={{ fontSize: 11, fontWeight: 600 }}
              title={assignmentTitle}
            >
              {assignmentTitle}
            </div>
          </div>
        </div>
        <div className="row" style={{ gap: 12, flexShrink: 0 }}>
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

      <div className="room-main">
        <div
          className="grid-room"
          style={{ isolation: "isolate", paddingBottom: 8 }}
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
                {studentInitial ?? ""}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 22,
                    fontWeight: 800,
                    letterSpacing: "-0.02em",
                    overflowWrap: "anywhere",
                  }}
                >
                  {studentName || t("interview.youName")}
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
            the host's side of the conversation in chronological order,
            with a soft glow when the host is currently speaking.
            Auto-scrolls to the latest line. */}
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
        <div className="room-dock-wrap">
          {/* SKIP / SWAP confirmation banner — always warns before acting. */}
          <AnimatePresence>
            {banner ? (
              <motion.div
                key={banner}
                role="alertdialog"
                aria-live="assertive"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={{ duration: 0.2 }}
                className="card"
                style={{
                  marginBottom: 12,
                  padding: "16px 20px",
                  borderRadius: 20,
                  background:
                    banner === "skip"
                      ? "rgba(255,241,245,0.97)"
                      : "rgba(240,249,255,0.97)",
                  border: `1px solid ${
                    banner === "skip"
                      ? "rgba(244,63,94,0.35)"
                      : "rgba(56,189,248,0.4)"
                  }`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "1 1 260px" }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>
                    {t(
                      banner === "skip"
                        ? "interview.skipBannerTitle"
                        : "interview.replaceBannerTitle",
                      { n: currentQuestionNumber },
                    )}
                  </div>
                  <div className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
                    {t(
                      banner === "skip"
                        ? "interview.skipBannerBody"
                        : "interview.replaceBannerBody",
                    )}
                  </div>
                </div>
                <div className="row" style={{ gap: 8, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "10px 14px", fontSize: 13 }}
                    onClick={() => setBanner(null)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{
                      padding: "10px 14px",
                      fontSize: 13,
                      ...(banner === "skip"
                        ? { background: "linear-gradient(135deg,#FDA4AF,#F43F5E)" }
                        : {}),
                    }}
                    onClick={banner === "skip" ? confirmSkip : confirmReplace}
                  >
                    {t(
                      banner === "skip"
                        ? "interview.skipConfirm"
                        : "interview.replaceConfirm",
                    )}
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          <div
            className="card room-dock"
            style={{
              padding: "16px 20px",
              borderRadius: 28,
              background: "rgba(255,255,255,0.94)",
              backdropFilter: "blur(8px)",
            }}
          >
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
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
              {!wrappingUp && !closingOrDone ? (
                <>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "12px 16px", fontSize: 13 }}
                    onClick={() => setBanner("skip")}
                    disabled={controlsLocked}
                  >
                    <span className="icon-flip">
                      <ArrowIcon />
                    </span>{" "}
                    {t("interview.skipQuestion")}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ padding: "12px 16px", fontSize: 13 }}
                    onClick={() => setBanner("replace")}
                    disabled={controlsLocked || replaceUsed}
                  >
                    <RepeatIcon size={14} />{" "}
                    {replaceUsed
                      ? t("interview.replaceUsed")
                      : t("interview.replaceQuestion")}
                  </button>
                </>
              ) : null}
            </div>

            <div
              className="row"
              style={{ gap: 16, alignItems: "center", flexWrap: "wrap" }}
            >
              {adapterMode === "openai" && wrappingUp ? (
                <div className="row" style={{ gap: 12, alignItems: "center" }}>
                  <Spinner />
                  <div style={{ fontSize: 14, fontWeight: 700 }}>
                    {t("interview.farewell")}
                  </div>
                </div>
              ) : adapterMode === "openai" ? (
                <>
                  <div
                    className="text-muted hide-sm"
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

