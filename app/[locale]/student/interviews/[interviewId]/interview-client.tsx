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
 * LANGUAGE + GUARD. `interviewLanguage` (he / en / ar, chosen in the lobby)
 * drives every heuristic, directive and caption setting; the UI `locale`
 * only drives the chrome. Each final student transcript passes through
 * `student-text-guard.ts`: noise / off-language turns are recorded as
 * `discarded_utterance:<kind>` system lines, never counted as answers, and
 * the host is told (system note) not to build on them.
 *
 * PAUSE only pauses the on-screen timer; the live session keeps running.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter } from "@/lib/i18n/navigation";
import { useTheme } from "@/components/providers/theme-provider";
import { Blobs } from "@/components/podtask/blobs";
import { Badge, Chip } from "@/components/podtask/chip";
import { BrandMark } from "@/components/podtask/brand-mark";
import { Eyebrow } from "@/components/podtask/eyebrow";
import type { OrbState } from "@/components/podtask/glow-orb";
import { MicButton } from "@/components/podtask/mic-button";
import {
  ArrowIcon,
  MicIcon,
  MicOffIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  RepeatIcon,
  SkipIcon,
  SparkIcon,
  StopIcon,
  XIcon,
} from "@/components/podtask/icons";
import { MOCK_INTERVIEW_QUESTIONS } from "@/lib/student/mock-data";
import { REALTIME_ADAPTER } from "@/lib/env";
import {
  buildFarewellInstructions,
  buildOwnWordsDirective,
  buildReplaceDirective,
  buildResumeDirective,
  buildSilenceNudgeDirective,
  buildSkipDirective,
  buildUnintelligibleDirective,
  isHostDirective,
  type FarewellReason,
  type UnintelligibleKind,
} from "@/lib/realtime/host-directives";
import {
  getDocumentText,
  recordDisconnect,
  recordIntegrityEvents,
  recordInterviewFlag,
} from "@/lib/student/student-service";
import type { IntegritySettings } from "@/lib/integrity/settings";
import type { IntegrityClientEvent } from "@/lib/integrity/types";
import { IntegrityEventQueue, type IntegritySyncState } from "@/lib/integrity/event-queue";
import { ActivityMonitor } from "@/lib/integrity/activity-monitor";
import {
  CameraMonitor,
  type CameraStatus,
  type TrackingStatus,
} from "@/lib/integrity/camera-monitor";
import { PREFERRED_CAMERA_KEY } from "@/lib/integrity/preferences";
import {
  formatLiveWarningDebug,
  type LiveWarning,
  type LiveWarningDebug,
} from "@/lib/integrity/live-warning";
import { playWarningChime } from "@/lib/integrity/warning-chime";
import {
  DocumentIndex,
  computeOverlap,
  isSignificantOverlap,
} from "@/lib/integrity/overlap";
import { assessStudentUtterance } from "@/lib/realtime/student-text-guard";
import {
  isRtlInterviewLanguage,
  type InterviewLanguage,
} from "@/lib/student/interview-language";
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
import {
  CaptionPacer,
  defaultCharsPerSecond,
} from "@/lib/realtime/caption-pacer";
import { createRealtimeSession } from "@/lib/realtime/realtime-client";
import {
  closingStrength,
  detectExplicitQuestionNumber,
  detectPlannedQuestionIndex,
  looksLikePlannedQuestionTransition,
} from "@/lib/realtime/host-text-heuristics";
import type { StudentInterviewQuestion } from "@/lib/student/types";
import {
  ForestIntegrity,
  ForestProgress,
  ForestStage,
  HostStage,
  QuestionProgress,
  Spinner,
  StudentTile,
  TranscriptBubble,
  VoiceBars,
  type ForestTone,
} from "./interview-parts";

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
// A rejected student turn steers the host at most this often: both final
// student events can carry the same turn, and one note is enough.
const GUARD_NOTE_COOLDOWN_MS = 4000;
// Silence nudges: the second one comes this long after the first, and there
// are never more than two per planned question.
const SECOND_NUDGE_DELAY_MS = 30_000;
const MAX_NUDGES_PER_QUESTION = 2;
// "In your own words" is asked at most this many times per interview.
const MAX_OWN_WORDS_PROMPTS = 2;
// Latencies longer than this are a reload / a pause, not thinking time.
const MAX_LATENCY_MS = 10 * 60 * 1000;

interface TurnEntry {
  id: string;
  text: string;
  final: boolean;
}

interface InterviewRoomClientProps {
  interviewId: string;
  submissionId: string;
  assignmentTitle: string;
  /** Forest top bar only: "course · student" under the title. */
  courseName?: string;
  studentFullName?: string;
  questions: StudentInterviewQuestion[];
  /** UI locale (chrome, labels). */
  locale: string;
  /** Language the host speaks and listens in; chosen in the lobby. */
  interviewLanguage: InterviewLanguage;
  /** Shown on the student card; falls back to a generic label. */
  studentName?: string;
  studentInitial?: string;
  /** Resolved per-assignment integrity flags (camera, telemetry, nudges…). */
  integrity: IntegritySettings;
  /** Where to continue from when the room reopens mid-interview. */
  resume: { lastQuestionIndex: number; answeredQuestionIds: string[] };
  attempt: number;
}

function makeTurnId(): string {
  return `t_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

// The host's measured speaking rate (characters per second) survives the
// session so the very first caption of the next interview is already in
// step with her voice. Per-device convenience only; any failure is ignored.
const CAPTION_RATE_KEY = "podtask.captionRate";

function loadCaptionRate(locale: string): number | null {
  try {
    const raw = window.localStorage.getItem(`${CAPTION_RATE_KEY}.${locale}`);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= 5 && n <= 30 ? n : null;
  } catch {
    return null;
  }
}

function saveCaptionRate(locale: string, charsPerSecond: number): void {
  try {
    window.localStorage.setItem(
      `${CAPTION_RATE_KEY}.${locale}`,
      charsPerSecond.toFixed(2),
    );
  } catch {
    /* private mode / quota; the default guess is fine */
  }
}

export function InterviewRoomClient({
  interviewId,
  submissionId,
  assignmentTitle,
  courseName,
  studentFullName,
  questions: initialQuestions,
  locale,
  interviewLanguage,
  studentName,
  studentInitial,
  integrity,
  resume,
  attempt,
}: InterviewRoomClientProps) {
  const t = useTranslations();
  const router = useRouter();
  // Visual skin only: the forest room rearranges the same pieces. Nothing
  // below this line behaves differently per theme.
  const { theme } = useTheme();
  const isForest = theme === "forest";
  // Forest only: the earlier-lines list can be folded away.
  const [transcriptOpen, setTranscriptOpen] = useState(true);
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
  const cappedQuestionsRef = useRef(cappedQuestions);
  useEffect(() => {
    cappedQuestionsRef.current = cappedQuestions;
  }, [cappedQuestions]);

  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);
  const [adapterError, setAdapterError] = useState<string | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>("idle");
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>("idle");
  // The warning sign on the self-view, and (with ?proctorDebug=1) the raw
  // detector readings behind it, for tuning the thresholds.
  const [liveWarning, setLiveWarning] = useState<LiveWarning | null>(null);
  const [proctorDebug, setProctorDebug] = useState<LiveWarningDebug | null>(null);
  // Exam-integrity UI state: the live counter in the badge, the sync dot and
  // the gentle "you left the screen" notice.
  const [exitCount, setExitCount] = useState(0);
  const [syncState, setSyncState] = useState<IntegritySyncState>("synced");
  const [returnNotice, setReturnNotice] = useState<{ ordinal: number; durationMs: number } | null>(null);
  const [showResumed, setShowResumed] = useState(resume.lastQuestionIndex >= 0);

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
  // The language the host actually speaks (he / en / ar). Starts from the
  // interview row and is confirmed by the minted session; every heuristic,
  // directive and caption setting reads it from here, never the UI locale.
  const hostLangRef = useRef<InterviewLanguage>(interviewLanguage);
  useEffect(() => {
    hostLangRef.current = interviewLanguage;
  }, [interviewLanguage]);
  // Prompt the transcription model was given; an utterance that merely
  // echoes it is noise (see student-text-guard.ts).
  const transcriptionHintRef = useRef<string | null>(null);
  const lastGuardNoteAtRef = useRef(0);
  // True between server-VAD speech_started and speech_stopped. A guard note
  // is pointless while the student is already giving the real answer: the
  // host will respond to that turn anyway, and the note would only
  // interrupt it.
  const studentSpeakingRef = useRef(false);

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
  // Caption pacing (see the transcript section below).
  const pacerRef = useRef<CaptionPacer | null>(null);
  const captionRevisionRef = useRef(-1);

  // ---- Section: integrity bookkeeping ----
  // Per-turn timing (client telemetry, stored with each persisted answer):
  // when the host's audio stopped, when the student's speech started and
  // stopped, and whether the student spoke over the host.
  const turnSeqRef = useRef(0);
  const currentTurnIdRef = useRef<string | null>(null);
  const speechStartedAtRef = useRef<number | null>(null);
  const speechStoppedAtRef = useRef<number | null>(null);
  const lastHostPlaybackStopAtRef = useRef<number | null>(null);
  const bargeInPendingRef = useRef(false);
  const muteTogglesRef = useRef(0);
  const mutedDuringTurnRef = useRef(false);
  const nudgedThisTurnRef = useRef(false);
  // Telemetry plumbing: one queue, the activity monitor and the camera.
  const eventQueueRef = useRef<IntegrityEventQueue | null>(null);
  const activityRef = useRef<ActivityMonitor | null>(null);
  const cameraRef = useRef<CameraMonitor | null>(null);
  // Silence nudges (per planned question).
  const nudgeTimerRef = useRef<number | null>(null);
  const nudgeStageRef = useRef(0);
  const nudgeQuestionRef = useRef(-1);
  // The nudge re-arms itself from inside its own timer; a ref avoids the
  // callback referring to itself.
  const armNudgeRef = useRef<() => void>(() => {});
  // "In your own words": the document index and how often we asked.
  const docIndexRef = useRef<DocumentIndex | null>(null);
  const ownWordsCountRef = useRef(0);
  const ownWordsQuestionsRef = useRef<Set<string>>(new Set());
  const resumeRef = useRef(resume);
  const integrityRef = useRef(integrity);
  useEffect(() => {
    integrityRef.current = integrity;
  }, [integrity]);

  // Which plan question the conversation is on right now (null during the
  // greeting, before the first ordinal announcement).
  const planQuestionIdNow = useCallback((): string | null => {
    const i = lastDetectedQuestionIndexRef.current;
    return i >= 0 ? (cappedQuestionsRef.current[i]?.id ?? null) : null;
  }, []);

  const pushIntegrityEvent = useCallback((event: IntegrityClientEvent) => {
    eventQueueRef.current?.push(event);
  }, []);

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
    // A fresh caption pacer is created lazily for the new interview.
    pacerRef.current = null;
    captionRevisionRef.current = -1;
    // Integrity bookkeeping starts clean too.
    turnSeqRef.current = 0;
    currentTurnIdRef.current = null;
    speechStartedAtRef.current = null;
    speechStoppedAtRef.current = null;
    lastHostPlaybackStopAtRef.current = null;
    bargeInPendingRef.current = false;
    muteTogglesRef.current = 0;
    mutedDuringTurnRef.current = false;
    nudgedThisTurnRef.current = false;
    nudgeStageRef.current = 0;
    nudgeQuestionRef.current = -1;
    ownWordsCountRef.current = 0;
    ownWordsQuestionsRef.current = new Set();
    // Reopening mid-interview: the host continues from the last question.
    const r = resumeRef.current;
    if (r.lastQuestionIndex >= 0) {
      lastDetectedQuestionIndexRef.current = r.lastQuestionIndex;
      for (let i = 0; i <= r.lastQuestionIndex; i++) askedQuestionIndexesRef.current.add(i);
      studentAnswerCountRef.current = r.answeredQuestionIds.length;
    }
  }, [interviewId]);

  // ---- Section: telemetry (activity, camera, document index) ----

  // Telemetry queue + browser activity monitor. Live sessions only, and
  // only when the assignment enables it. Every event is client telemetry
  // and is labelled as such on the lecturer's side.
  useEffect(() => {
    // Mock rooms run the same monitors (the badge, counter and notice are
    // real); `recordIntegrityEvents` stores nothing for non-UUID ids.
    const queue = new IntegrityEventQueue(
      (events, opts) => recordIntegrityEvents(interviewId, events, opts),
      {
        storageKey: `podtask.integrity.${interviewId}`,
        onSync: (state) => setSyncState(state),
      },
    );
    eventQueueRef.current = queue;
    let activity: ActivityMonitor | null = null;
    if (integrity.activityMonitoring) {
      activity = new ActivityMonitor({
        onEvent: (event) => queue.push(event),
        getPlanQuestionId: planQuestionIdNow,
        trackFullscreen: integrity.fullscreen,
        onReturn: (info) => {
          setExitCount(info.ordinal);
          setReturnNotice(info);
        },
      });
      activity.start();
      activityRef.current = activity;
    }
    // Only a keepalive request survives the navigation away from the room.
    const onPageHide = () => {
      void queue.flush({ keepalive: true });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      activity?.stop();
      activityRef.current = null;
      void queue.flush({ keepalive: true });
      queue.dispose();
      eventQueueRef.current = null;
    };
    // adapterMode / interviewId / flags are stable for the life of the room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapterMode, interviewId, integrity.activityMonitoring, integrity.fullscreen]);

  // Camera: a self-view plus on-device face presence. Nothing is uploaded.
  useEffect(() => {
    if (integrity.camera === "off") return;
    let deviceId: string | null = null;
    try {
      deviceId = window.sessionStorage.getItem(PREFERRED_CAMERA_KEY);
    } catch {
      /* private mode */
    }
    const debug = new URLSearchParams(window.location.search).has("proctorDebug");
    const camera = new CameraMonitor({
      onStatus: setCameraStatus,
      onEvent: (event) => eventQueueRef.current?.push(event),
      onTracking: (status) => setTrackingStatus(status),
      onWarning: setLiveWarning,
      onDebug: debug ? setProctorDebug : undefined,
      getPlanQuestionId: planQuestionIdNow,
      detectFaces: true,
      headPose: integrity.headPose,
      deviceId,
    });
    cameraRef.current = camera;
    void camera.start();
    return () => {
      camera.stop();
      cameraRef.current = null;
      setLiveWarning(null);
    };
  }, [integrity.camera, integrity.headPose, planQuestionIdNow]);

  // The submitted text, for the live "in your own words" check.
  useEffect(() => {
    if (adapterMode !== "openai" || !integrity.overlapCheck) return;
    let cancelled = false;
    getDocumentText(submissionId)
      .then((doc) => {
        if (cancelled || !doc || doc.text.length < 200) return;
        docIndexRef.current = new DocumentIndex(doc.text);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      docIndexRef.current = null;
    };
  }, [adapterMode, submissionId, integrity.overlapCheck]);

  // A soft chime when a sign appears or changes, never when it clears.
  const chimedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!liveWarning) {
      chimedForRef.current = null;
      return;
    }
    const key = `${liveWarning.reason}:${liveWarning.since}`;
    if (chimedForRef.current === key) return;
    chimedForRef.current = key;
    playWarningChime();
  }, [liveWarning]);

  const retryCamera = useCallback(() => {
    void cameraRef.current?.restart();
  }, []);

  // The self-view <video> lives in the student tile; the monitor may be
  // created before or after it mounts, so both sides attach.
  const cameraVideoElRef = useRef<HTMLVideoElement | null>(null);
  const attachCameraVideo = useCallback((el: HTMLVideoElement | null) => {
    cameraVideoElRef.current = el;
    cameraRef.current?.attachVideo(el);
  }, []);
  useEffect(() => {
    if (cameraStatus === "on") cameraRef.current?.attachVideo(cameraVideoElRef.current);
  }, [cameraStatus]);

  // ---- Section: transcript buffer ----

  // Rolling on-screen transcript of the HOST's speech (student answers are
  // persisted to the DB but not rendered). The server sends the text well
  // ahead of the voice, so it goes through `CaptionPacer`, which reveals it
  // word by word in step with the audio (see that module for the why). Each
  // entry is one response ("turn"); `final` flips once the turn was spoken
  // and shown in full.
  const [transcript, setTranscript] = useState<TurnEntry[]>([]);

  const getPacer = useCallback(() => {
    if (!pacerRef.current) {
      const language = hostLangRef.current;
      pacerRef.current = new CaptionPacer({
        charsPerSecond:
          loadCaptionRate(language) ?? defaultCharsPerSecond(language),
        makeId: makeTurnId,
      });
    }
    return pacerRef.current;
  }, []);

  // Push the pacer's view into React state, only when it actually changed.
  const syncCaptions = useCallback(() => {
    const pacer = pacerRef.current;
    if (!pacer || pacer.revision === captionRevisionRef.current) return;
    captionRevisionRef.current = pacer.revision;
    setTranscript(pacer.snapshot());
  }, []);

  // Reveal loop: a few times a second, advance the captions along the
  // host's speaking clock. Live sessions only.
  useEffect(() => {
    if (adapterMode !== "openai") return;
    const id = window.setInterval(() => {
      const pacer = pacerRef.current;
      if (pacer && pacer.tick(performance.now())) syncCaptions();
    }, 50);
    return () => window.clearInterval(id);
  }, [adapterMode, syncCaptions]);

  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = transcriptScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [transcript]);

  const appendTranscriptDelta = useCallback(
    (delta: string, responseId?: string) => {
      if (!delta) return;
      getPacer().pushDelta(delta, performance.now(), responseId);
      syncCaptions();
    },
    [getPacer, syncCaptions],
  );

  // ---- Section: closing (every path ends in closeNow) ----

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
      // Grounded goodbye: the host may only recall what was really said, and
      // when nothing usable was captured (dead mic) it says so instead of
      // inventing a recap.
      const instructions = buildFarewellInstructions(hostLangRef.current, reason, {
        assignmentTitle,
        studentSpoke: studentAnswerCountRef.current > 0,
      });
      const startedAt = Date.now();
      const trySend = () => {
        if (finalAnswerHandledRef.current || adapterRef.current !== adapter) return;
        if (adapter.isResponseActive() && Date.now() - startedAt < 3000) {
          farewellRef.current.timers.push(window.setTimeout(trySend, 120));
          return;
        }
        try {
          // Speech only: left to "auto", the model sometimes answers the
          // farewell request with a bare finish_interview call and the
          // student hears nothing (observed live, 2026-10-14).
          adapter.sendEvent({
            type: "response.create",
            response: { instructions, tool_choice: "none" },
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
    [closeNow, assignmentTitle],
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
      const strength = closingStrength(lastAssistantTextRef.current, hostLangRef.current);
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

  // ---- Section: silence nudges ----

  const clearNudgeTimer = useCallback(() => {
    if (nudgeTimerRef.current !== null) {
      window.clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = null;
    }
  }, []);

  // Inject text as if the student had typed it (skip / swap / guard notes),
  // once the server is idle. Cancels whatever the host is saying first so
  // the reaction is immediate. A note still queued when the farewell starts
  // is dropped, so it can never take the goodbye's response slot.
  const injectUserText = useCallback((text: string) => {
    const adapter = adapterRef.current;
    if (!adapter) return;
    if (farewellRef.current.started || finalAnswerHandledRef.current) return;
    adapter.cancelActiveResponse();
    const startedAt = Date.now();
    const trySend = () => {
      if (adapterRef.current !== adapter) return;
      if (farewellRef.current.started || finalAnswerHandledRef.current) return;
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

  // The student has been quiet on their turn. After `silenceNudgeSeconds`
  // the host says one warm sentence; a good while later, once more, offering
  // an easier angle or to leave the question for now. Never more than two
  // per question, never while someone is speaking, never while paused or
  // muted, never during the farewell, and never a countdown.
  const armNudge = useCallback(() => {
    clearNudgeTimer();
    const seconds = integrityRef.current.silenceNudgeSeconds;
    if (adapterMode !== "openai" || seconds <= 0) return;
    if (farewellRef.current.started || finalAnswerHandledRef.current) return;
    const questionIdx = lastDetectedQuestionIndexRef.current;
    if (nudgeQuestionRef.current !== questionIdx) {
      nudgeQuestionRef.current = questionIdx;
      nudgeStageRef.current = 0;
    }
    if (nudgeStageRef.current >= MAX_NUDGES_PER_QUESTION) return;
    const delay = nudgeStageRef.current === 0 ? seconds * 1000 : SECOND_NUDGE_DELAY_MS;
    nudgeTimerRef.current = window.setTimeout(() => {
      nudgeTimerRef.current = null;
      if (farewellRef.current.started || finalAnswerHandledRef.current) return;
      const adapter = adapterRef.current;
      if (!adapter) return;
      // Not a silence: someone is talking, the mic is off, or the timer is paused.
      if (
        studentSpeakingRef.current ||
        hostSpeakingRef.current ||
        pausedRef.current ||
        !adapter.isMicEnabled()
      ) {
        nudgeTimerRef.current = window.setTimeout(() => {
          nudgeTimerRef.current = null;
          armNudgeRef.current();
        }, 5000);
        return;
      }
      const stage = (nudgeStageRef.current + 1) as 1 | 2;
      nudgeStageRef.current = stage;
      nudgedThisTurnRef.current = true;
      injectUserText(buildSilenceNudgeDirective(hostLangRef.current, stage));
      pushIntegrityEvent({
        kind: "silence_nudge",
        startedAt: new Date().toISOString(),
        planQuestionId: planQuestionIdNow(),
        payload: { stage, after_seconds: stage === 1 ? seconds : SECOND_NUDGE_DELAY_MS / 1000 },
      });
    }, delay);
  }, [adapterMode, clearNudgeTimer, injectUserText, planQuestionIdNow, pushIntegrityEvent]);
  useEffect(() => {
    armNudgeRef.current = armNudge;
  }, [armNudge]);

  // The final text of a turn. Both `transcript.done` and `item.done` land
  // here; the pacer dedupes them and keeps revealing at the voice's pace.
  const finalizeTranscript = useCallback(
    (finalText: string, responseId?: string) => {
      getPacer().finalize(finalText, performance.now(), responseId);
      syncCaptions();
    },
    [getPacer, syncCaptions],
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
        // The session was minted for this language; follow it even if the
        // page rendered with a stale row.
        hostLangRef.current = token.language;
        transcriptionHintRef.current = token.transcriptionHint;

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

        // A turn the guard rejected (noise / another language): record it
        // for the report, and tell the host not to build on it (it heard the
        // audio natively and may already be replying to it).
        const rejectStudentTurn = (kind: UnintelligibleKind) => {
          sessionRef.current.persistSystemMessage(
            `discarded_utterance:${kind}`,
            currentPlanQuestionId(),
          );
          if (farewellRef.current.started || finalAnswerHandledRef.current) return;
          // The student is already speaking the real answer (a cough or a
          // false start was committed as its own turn): no note, the host
          // answers the real turn.
          if (studentSpeakingRef.current) return;
          const now = Date.now();
          if (now - lastGuardNoteAtRef.current < GUARD_NOTE_COOLDOWN_MS) return;
          lastGuardNoteAtRef.current = now;
          injectUserText(buildUnintelligibleDirective(hostLangRef.current, kind));
        };

        // Timing of the turn that just ended, for the persisted answer. Both
        // final events of a turn share one client id, so the server keeps
        // the first row and drops the second.
        const turnMetadata = () => {
          const startedAt = speechStartedAtRef.current;
          const stoppedAt = speechStoppedAtRef.current;
          const hostStop = lastHostPlaybackStopAtRef.current;
          const meta: Record<string, unknown> = {
            question_index: lastDetectedQuestionIndexRef.current,
            barge_in: bargeInPendingRef.current,
            mute_toggles: muteTogglesRef.current,
            muted_during_turn: mutedDuringTurnRef.current,
            nudged: nudgedThisTurnRef.current,
          };
          if (hostStop !== null) meta.host_turn_ended_at = new Date(hostStop).toISOString();
          if (startedAt !== null) {
            meta.speech_started_at = new Date(startedAt).toISOString();
            if (hostStop !== null && startedAt >= hostStop && startedAt - hostStop <= MAX_LATENCY_MS) {
              meta.latency_ms = startedAt - hostStop;
            }
            if (stoppedAt !== null && stoppedAt >= startedAt) {
              meta.speech_stopped_at = new Date(stoppedAt).toISOString();
              meta.speech_ms = stoppedAt - startedAt;
            }
          }
          const counters = activityRef.current?.drainCounters();
          if (counters) {
            meta.hidden_ms_since_last = counters.hiddenMs;
            meta.blur_count_since_last = counters.blurCount;
          }
          return {
            clientId: currentTurnIdRef.current ?? makeTurnId(),
            startedAt: startedAt !== null ? new Date(startedAt).toISOString() : undefined,
            endedAt: stoppedAt !== null ? new Date(stoppedAt).toISOString() : undefined,
            metadata: meta,
          };
        };
        const resetTurnCounters = () => {
          bargeInPendingRef.current = false;
          muteTogglesRef.current = 0;
          mutedDuringTurnRef.current = false;
          nudgedThisTurnRef.current = false;
        };

        // The last answer matched the submitted document almost verbatim:
        // ask (warmly, at most twice per interview, once per question) for
        // the idea in the student's own words. Using the work is allowed;
        // the follow-up is what the lecturer reads.
        const maybeAskOwnWords = (text: string) => {
          const index = docIndexRef.current;
          if (!index || !integrityRef.current.overlapCheck) return;
          if (farewellRef.current.started || finalAnswerHandledRef.current) return;
          if (ownWordsCountRef.current >= MAX_OWN_WORDS_PROMPTS) return;
          const qid = currentPlanQuestionId() ?? "_intro";
          if (ownWordsQuestionsRef.current.has(qid)) return;
          const result = computeOverlap(text, index);
          if (!isSignificantOverlap(result)) return;
          ownWordsQuestionsRef.current.add(qid);
          ownWordsCountRef.current += 1;
          injectUserText(buildOwnWordsDirective(hostLangRef.current));
          pushIntegrityEvent({
            kind: "own_words_prompt",
            startedAt: new Date().toISOString(),
            planQuestionId: currentPlanQuestionId(),
            payload: { longest_run: result.longestRun, share: Number(result.score.toFixed(2)) },
          });
        };

        const handleStudentUtterance = (text: string) => {
          if (!text) return;
          // Our own skip / swap / guard notes come back as user items: keep
          // them in the transcript (the report hides them), never judge or
          // count them.
          if (isHostDirective(text)) {
            sessionRef.current.persistStudentMessage(text, currentPlanQuestionId(), {
              metadata: { kind: "directive_echo" },
            });
            return;
          }
          const verdict = assessStudentUtterance(text, {
            language: hostLangRef.current,
            transcriptionHint: transcriptionHintRef.current,
          });
          if (verdict !== "ok") {
            rejectStudentTurn(verdict);
            return;
          }
          sessionRef.current.persistStudentMessage(text, currentPlanQuestionId(), turnMetadata());
          resetTurnCounters();
          if (text.trim().length <= 2) return;
          studentAnswerCountRef.current += 1;
          maybeAskOwnWords(text);
          if (waitingForFinalAnswerRef.current && !finalAnswerGivenRef.current) {
            // The last planned question has been answered. Do NOT close
            // here — the host still has to react and say goodbye. The
            // watchdog asks for the farewell if the model never wraps up.
            finalAnswerGivenRef.current = true;
            armFinalAnswerWatchdog(FINAL_ANSWER_WATCHDOG_MS);
          }
        };

        // The room is going away without a proper close (connection drop,
        // failure): one keepalive request records it.
        const reportDisconnect = (reason: string) => {
          const s = sessionRef.current;
          if (s.state === "completed" || s.state === "closing") return;
          void eventQueueRef.current?.flush({ keepalive: true });
          void recordDisconnect(interviewId, reason, currentPlanQuestionId());
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
            // somehow exists it clears the way first. After a drop the
            // kick is a resume note instead, so the host continues from
            // the question the conversation was on.
            try {
              adapter.cancelActiveResponse();
              const r = resumeRef.current;
              if (r.lastQuestionIndex >= 0) {
                sessionRef.current.setQuestionIndex(r.lastQuestionIndex);
                adapter.sendUserText(
                  buildResumeDirective(
                    hostLangRef.current,
                    r.lastQuestionIndex + 1,
                    r.answeredQuestionIds.length,
                  ),
                );
                pushIntegrityEvent({
                  kind: "reconnect",
                  startedAt: new Date().toISOString(),
                  planQuestionId: cappedQuestions[r.lastQuestionIndex]?.id ?? null,
                  payload: { attempt },
                });
              } else {
                adapter.sendEvent({ type: "response.create" });
              }
            } catch {
              /* data channel may be racing; the next user audio will trigger anyway */
            }
          },
          onClose: () => {
            const s = sessionRef.current;
            if (s.state !== "completed" && s.state !== "closing") {
              reportDisconnect("data_channel_closed");
              s.fail("data_channel_closed");
            }
          },
          onError: (err) => {
            reportDisconnect(err.message);
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
            studentSpeakingRef.current = true;
            clearNudgeTimer();
            turnSeqRef.current += 1;
            currentTurnIdRef.current = `s-${turnSeqRef.current}-${makeTurnId()}`;
            speechStartedAtRef.current = Date.now();
            speechStoppedAtRef.current = null;
            sessionRef.current.startRecording();
          },
          onUserSpeechStop: () => {
            studentSpeakingRef.current = false;
            speechStoppedAtRef.current = Date.now();
            sessionRef.current.finishRecording(undefined, { persist: false });
          },
          onAssistantMessageDone: (text) => {
            if (!text) return;
            const loc = hostLangRef.current;
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
              {
                clientId: `h-${makeTurnId()}`,
                metadata: { question_index: lastDetectedQuestionIndexRef.current },
              },
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
          onAssistantTranscriptDelta: (delta, responseId) => {
            appendTranscriptDelta(delta, responseId);
          },
          onAssistantTranscriptDone: (text, responseId) => {
            finalizeTranscript(text, responseId);
          },
          // Playback edges pace the captions: the voice started / is over.
          onAssistantPlaybackStart: (responseId) => {
            getPacer().playbackStarted(performance.now(), responseId);
            syncCaptions();
          },
          onAssistantPlaybackStop: (responseId, reason) => {
            const pacer = getPacer();
            pacer.playbackStopped(performance.now(), responseId);
            syncCaptions();
            saveCaptionRate(hostLangRef.current, pacer.charsPerSecond);
            // The floor is the student's from here: start the latency clock
            // and the (gentle) silence clock. A cleared buffer means the
            // student spoke over the host.
            lastHostPlaybackStopAtRef.current = Date.now();
            if (reason === "cleared") bargeInPendingRef.current = true;
            armNudge();
          },
          onUserTranscriptDone: handleStudentUtterance,
          // VAD opened a turn but no words came out of it: noise.
          onUserTranscriptEmpty: () => rejectStudentTurn("noise"),
          onAssistantAudioLevel: (level) => {
            setHostLevel(level);
            // "Is the voice audible right now" for the caption clock.
            getPacer().noteLevel(level, performance.now());
          },
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
            } else if (call.name === "flag_answer") {
              // A silent review note for the lecturer. The host keeps
              // talking as if nothing happened (default createResponse).
              try {
                adapter.respondToTool(call.callId, { ok: true });
              } catch {
                /* noop */
              }
              if (integrityRef.current.hostFlags) {
                const a = call.args;
                void recordInterviewFlag(interviewId, {
                  category: typeof a.category === "string" ? a.category : "other",
                  description:
                    typeof a.description === "string" ? a.description : "",
                  quote: typeof a.quote === "string" ? a.quote : null,
                  confidence:
                    typeof a.confidence === "string" ? a.confidence : "low",
                  planQuestionId: currentPlanQuestionId(),
                });
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
        // Tear down the half-built adapter: connect() starts the audio-level
        // RAF loop and AudioContext before the SDP handshake, so a failed
        // handshake would otherwise leave them running until unmount.
        adapterRef.current?.disconnect();
        adapterRef.current = null;
      }
    })();

    return () => {
      cancelled = true;
      clearNudgeTimer();
      adapterRef.current?.disconnect();
      adapterRef.current = null;
      micStream?.getTracks().forEach((tk) => tk.stop());
      clearClosingTimers();
    };
  }, [
    adapterMode,
    interviewId,
    attempt,
    appendTranscriptDelta,
    finalizeTranscript,
    getPacer,
    syncCaptions,
    beginFarewell,
    sendFarewellResponse,
    closeAfterHostSilent,
    armFinalAnswerWatchdog,
    clearClosingTimers,
    clearNudgeTimer,
    armNudge,
    injectUserText,
    pushIntegrityEvent,
    cappedQuestions,
  ]);

  // Once the farewell starts or the room closes, no nudge may fire.
  useEffect(() => {
    if (wrappingUp || session.state === "closing" || session.state === "completed") {
      clearNudgeTimer();
    }
  }, [wrappingUp, session.state, clearNudgeTimer]);

  // The "we're back" chip fades on its own.
  useEffect(() => {
    if (!showResumed) return;
    const id = window.setTimeout(() => setShowResumed(false), 9000);
    return () => window.clearTimeout(id);
  }, [showResumed]);

  // The "you left the screen" notice: calm, informative, and gone on its own.
  useEffect(() => {
    if (!returnNotice) return;
    const id = window.setTimeout(() => setReturnNotice(null), 9000);
    return () => window.clearTimeout(id);
  }, [returnNotice]);

  const monitoringOn = integrity.activityMonitoring || integrity.camera !== "off";
  const trackingLabel =
    integrity.camera === "off"
      ? undefined
      : cameraStatus !== "on"
        ? undefined
        : trackingStatus === "on"
          ? t("interview.trackingOn")
          : trackingStatus === "loading"
            ? t("interview.trackingLoading")
            : trackingStatus === "unavailable"
              ? t("interview.trackingUnavailable")
              : undefined;
  const trackingTone: "ok" | "muted" | "warn" =
    trackingStatus === "on" ? "ok" : trackingStatus === "unavailable" ? "warn" : "muted";

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
    muteTogglesRef.current += 1;
    if (!result) {
      mutedDuringTurnRef.current = true;
      pushIntegrityEvent({
        kind: "mic_muted",
        startedAt: new Date().toISOString(),
        planQuestionId: planQuestionIdNow(),
      });
    }
  }, [planQuestionIdNow, pushIntegrityEvent]);

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
      injectUserText(buildSkipDirective(hostLangRef.current, idx + 1, total, isLast));
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
      injectUserText(buildReplaceDirective(hostLangRef.current, idx + 1));
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

  // ---- Section: stage view state (presentational only) ----

  const isLive = adapterMode === "openai";
  const connecting =
    session.state === "idle" || session.state === "connecting";
  // Longer holds than `hostGlow`: the orb and the turn chips should not flip
  // between "speaking" and "listening" on every breath.
  const hostSpeaking = useHeldTrue(hostActive, 900);
  const studentSpeaking = useHeldTrue(userActive, 400);
  const mockStudentTurn =
    session.state === "student_turn" || session.state === "student_recording";
  const hostOrbState: OrbState = hostSpeaking
    ? "speaking"
    : connecting || processing
      ? "thinking"
      : wrappingUp || closingOrDone
        ? "idle"
        : isLive || mockStudentTurn
          ? "listening"
          : "idle";
  const hostStatusLabel =
    hostOrbState === "speaking"
      ? t("interview.speaking")
      : hostOrbState === "thinking"
        ? connecting
          ? t("interview.connecting")
          : t("interview.thinking")
        : hostOrbState === "listening"
          ? t("interview.listening")
          : t("interview.waiting");
  const studentTurn = hostOrbState === "listening";
  const totalQuestions = cappedQuestions.length;
  const currentQuestion =
    cappedQuestions[
      Math.min(totalQuestions - 1, Math.max(0, session.questionIndex))
    ];

  // ---- Section: forest view state (presentational only) ----
  // Everything here only feeds the forest markup; the classic room never
  // reads it.

  const hostName = t("lobby.hostName");
  const forestStatus: { label: string; tone: ForestTone } =
    hostOrbState === "speaking"
      ? { label: t("forestRoom.statusSpeaking"), tone: "on" }
      : hostOrbState === "listening"
        ? { label: t("forestRoom.statusListening"), tone: "on" }
        : hostOrbState === "thinking"
          ? {
              label: connecting
                ? t("forestRoom.statusConnecting")
                : t("forestRoom.statusThinking"),
              tone: "busy",
            }
          : {
              label:
                wrappingUp || closingOrDone
                  ? t("forestRoom.statusEnding")
                  : t("forestRoom.statusWaiting"),
              tone: "off",
            };
  // The big text: the host's latest words in live sessions, the question on
  // the table in the mock driver. Earlier host lines go to the list below.
  const spokenLines = isLive ? transcript.filter((entry) => entry.text) : [];
  const latestLine = spokenLines[spokenLines.length - 1];
  const forestText = isLive
    ? (latestLine?.text ?? t("forestRoom.emptyCaption"))
    : (currentQuestion?.question ?? "");
  const forestTextMuted = isLive && !latestLine;
  const forestListen: { label: string; tone: ForestTone } = isLive
    ? muted
      ? { label: t("forestRoom.listenMuted"), tone: "off" }
      : studentSpeaking
        ? { label: t("forestRoom.listenHearing"), tone: "on" }
        : studentTurn
          ? { label: t("forestRoom.listenYourTurn"), tone: "on" }
          : { label: t("forestRoom.listenOpen"), tone: "busy" }
    : recording
      ? { label: t("forestRoom.listenMockRecording"), tone: "rec" }
      : session.state === "student_turn"
        ? { label: t("forestRoom.listenMockTurn"), tone: "on" }
        : { label: t("forestRoom.listenMockWait"), tone: "busy" };
  const forestCamLabel =
    cameraStatus === "on"
      ? t("forestRoom.cameraOn")
      : cameraStatus === "idle" || cameraStatus === "starting"
        ? t("forestRoom.cameraStarting")
        : t("forestRoom.cameraOff");
  const cameraMonitored = integrity.camera !== "off";
  const forestMonitorBody =
    integrity.activityMonitoring && cameraMonitored
      ? t("forestRoom.monitorBoth")
      : integrity.activityMonitoring
        ? t("forestRoom.monitorTabs")
        : t("forestRoom.monitorCamera");
  const forestSubline = [courseName, studentFullName].filter(Boolean).join(" · ");
  const toggleTranscript = () => {
    setTranscriptOpen((open) => !open);
    // Reopened: land on the latest line again.
    window.requestAnimationFrame(() => {
      const el = transcriptScrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  // ---- Section: JSX ----

  return (
    <div
      className={isForest ? "screen-fade fr-room" : "screen-fade"}
      style={{ minHeight: "100vh", position: "relative" }}
    >
      <Blobs variant="studio" />

      {isForest ? (
        <header className="topbar fr-top">
          <div className="fr-top-start">
            <BrandMark size={56} />
            <span className="tb-divider fr-top-sep" aria-hidden />
            <span className="fr-top-area">{t("forestRoom.area")}</span>
          </div>
          <div className="fr-top-center">
            <div className="fr-top-title" title={assignmentTitle}>
              {assignmentTitle}
            </div>
            {forestSubline ? (
              <div className="fr-top-sub">{forestSubline}</div>
            ) : null}
          </div>
          <div className="fr-top-end">
            <span className="fr-top-time" aria-label={t("forestRoom.timeLabel")}>
              {formatTime(elapsed)}
            </span>
            <span className="tb-divider" aria-hidden />
            <span className="fr-top-live">
              <span className="fr-dot" aria-hidden />
              {t("forestRoom.live")}
            </span>
          </div>
        </header>
      ) : (
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
            {showResumed ? (
              <Badge variant="mint" className="hide-sm">
                {t("interview.resumedChip")}
              </Badge>
            ) : null}
            {monitoringOn ? (
              <Badge
                variant={exitCount >= 3 ? "amber" : "mint"}
                className="room-monitor-badge"
              >
                <span className="room-monitor-sync" data-sync={syncState} aria-hidden />
                {t("interview.monitorActive")}
                {exitCount > 0 ? (
                  <span className="room-monitor-count">
                    {t("interview.monitorExits", { n: exitCount })}
                  </span>
                ) : null}
                <span className="sr-only">{t(`interview.sync_${syncState}`)}</span>
              </Badge>
            ) : null}
            <Badge variant="pink" className="room-rec">
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
      )}

      {/* "You left the exam screen" notice: recorded, not accusatory. */}
      <AnimatePresence>
        {returnNotice ? (
          <motion.div
            key={`return-${returnNotice.ordinal}`}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="room-return-notice"
            data-repeat={returnNotice.ordinal >= 3 ? "true" : undefined}
          >
            <div style={{ flex: "1 1 240px" }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>
                {t(returnNotice.ordinal >= 3 ? "interview.returnNoticeRepeatTitle" : "interview.returnNoticeTitle")}
              </div>
              <div style={{ fontSize: 13, marginTop: 2, lineHeight: 1.5 }}>
                {t(returnNotice.ordinal >= 3 ? "interview.returnNoticeRepeatBody" : "interview.returnNoticeBody", {
                  n: returnNotice.ordinal,
                })}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: "6px 12px", fontSize: 12 }}
              onClick={() => setReturnNotice(null)}
            >
              {t("interview.returnNoticeDismiss")}
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="room-main">
        <div className="room-grid">
          {isForest ? (
            <ForestStage
              status={forestStatus.label}
              statusTone={forestStatus.tone}
              extraChip={
                showResumed ? (
                  <span className="fr-status fr-resumed" data-tone="on">
                    {t("interview.resumedChip")}
                  </span>
                ) : null
              }
              questionLabel={t("forestRoom.questionOf", {
                current: currentQuestionNumber,
                total: totalQuestions,
              })}
              text={forestText}
              textDir={
                isLive
                  ? isRtlInterviewLanguage(interviewLanguage)
                    ? "rtl"
                    : "ltr"
                  : "auto"
              }
              textMuted={forestTextMuted}
              hint={t("forestRoom.answerHint")}
              listenLabel={forestListen.label}
              listenTone={forestListen.tone}
              bars={
                <VoiceBars
                  className="fr-bars"
                  level={isLive ? userLevel : undefined}
                  active={!muted && (isLive ? true : recording)}
                />
              }
              transcript={
                isLive
                  ? {
                      title: t("forestRoom.transcriptTitle"),
                      open: transcriptOpen,
                      onToggle: toggleTranscript,
                      lines: spokenLines.slice(0, -1),
                      empty: t("forestRoom.transcriptEmpty"),
                      hostName,
                      hostInitial: hostName.slice(0, 1),
                      label: t("interview.liveTranscript"),
                    }
                  : undefined
              }
              transcriptRef={isLive ? transcriptScrollRef : undefined}
            />
          ) : (
            <HostStage
              eyebrow={
                <Eyebrow icon={<SparkIcon size={14} />}>
                  {t("interview.aiHost")}
                </Eyebrow>
              }
              chip={
                <Chip variant={hostOrbState === "speaking" ? "cyan" : "default"}>
                  <span
                    data-pulse={hostOrbState !== "idle" ? "true" : undefined}
                    style={{
                      display: "inline-flex",
                      color:
                        hostOrbState === "listening"
                          ? "rgb(var(--pink-deep))"
                          : "rgb(var(--cyan))",
                    }}
                  >
                    <span className="room-state-dot" />
                  </span>
                  {hostStatusLabel}
                </Chip>
              }
              name={t("lobby.hostName")}
              role={t("interview.podcastHost")}
              orbState={hostOrbState}
              level={isLive ? hostLevel : undefined}
            >
              {/* CAPTIONS, right under the orb. Live: the host's side of the
                  conversation in chronological order, auto-scrolled to the
                  latest line. The mock driver has no transcript, so it shows
                  the question on the table instead. */}
              {isLive ? (
                <div
                  className="room-captions"
                  data-live={hostGlow ? "true" : undefined}
                  dir={isRtlInterviewLanguage(interviewLanguage) ? "rtl" : "ltr"}
                  aria-label={t("interview.liveTranscript")}
                >
                  <div ref={transcriptScrollRef} className="room-captions-scroll">
                    {transcript.length === 0 ? (
                      <div className="room-captions-empty">
                        {hostStatusLabel}
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
                </div>
              ) : (
                <div
                  className="room-captions"
                  aria-label={t("interview.currentQuestion")}
                >
                  <p className="room-question">{currentQuestion?.question}</p>
                </div>
              )}
            </HostStage>
          )}

          <div className="room-side">
            <StudentTile
              eyebrow={<Eyebrow showDot>{t("interview.you")}</Eyebrow>}
              chip={
                muted ? (
                  <Chip>
                    <MicOffIcon size={12} /> {t("interview.muted")}
                  </Chip>
                ) : studentTurn ? (
                  <Chip variant="pink">
                    <span
                      data-pulse="true"
                      style={{
                        display: "inline-flex",
                        color: "rgb(var(--pink-deep))",
                      }}
                    >
                      <span className="room-state-dot" />
                    </span>
                    {t("interview.yourTurn")}
                  </Chip>
                ) : (
                  <Chip>{t("interview.waiting")}</Chip>
                )
              }
              initial={studentInitial ?? ""}
              name={studentName || t("interview.youName")}
              status={
                muted
                  ? t("interview.muted")
                  : studentSpeaking
                    ? t("interview.shareThoughts")
                    : studentTurn
                      ? t("interview.takeYourTime")
                      : t("interview.listening")
              }
              level={isLive ? userLevel : undefined}
              speaking={isLive ? studentSpeaking : recording}
              muted={muted}
              cameraStatus={integrity.camera === "off" ? undefined : cameraStatus}
              cameraLabel={t("interview.cameraOn")}
              trackingLabel={trackingLabel}
              trackingTone={trackingTone}
              warning={liveWarning ? t(`interview.warn_${liveWarning.reason}`) : null}
              debugLine={proctorDebug ? formatLiveWarningDebug(proctorDebug) : undefined}
              videoRef={attachCameraVideo}
              overlay={
                isForest ? (
                  <>
                    <span
                      className="fr-cam-pill"
                      data-on={cameraStatus === "on" ? "true" : undefined}
                    >
                      <span className="fr-dot" aria-hidden />
                      {forestCamLabel}
                    </span>
                    <span className="fr-cam-label">{t("forestRoom.selfView")}</span>
                  </>
                ) : undefined
              }
            />
            {integrity.camera !== "off" &&
            (cameraStatus === "denied" ||
              cameraStatus === "off" ||
              cameraStatus === "unavailable") ? (
              <div className="room-cam-notice fade-up" role="status">
                <div style={{ fontWeight: 800, fontSize: 13 }}>
                  {cameraStatus === "denied"
                    ? t("interview.cameraDenied")
                    : cameraStatus === "unavailable"
                      ? t("interview.cameraUnavailable")
                      : t("interview.cameraOff")}
                </div>
                <div className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {integrity.camera === "required"
                    ? t("interview.cameraRequiredBody")
                    : t("interview.cameraNoticeBody")}
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: 10, padding: "8px 12px", fontSize: 12 }}
                  onClick={retryCamera}
                >
                  {t("interview.cameraReconnect")}
                </button>
              </div>
            ) : null}
            {isForest ? (
              <ForestProgress
                heading={t("forestRoom.progressTitle")}
                countLabel={t("forestRoom.questionOf", {
                  current: currentQuestionNumber,
                  total: totalQuestions,
                })}
                current={currentQuestionNumber}
                total={totalQuestions}
                allDone={wrappingUp || closingOrDone}
              />
            ) : (
              <QuestionProgress
                title={t("interview.questionOf", {
                  current: currentQuestionNumber,
                  total: totalQuestions,
                })}
                current={currentQuestionNumber}
                total={totalQuestions}
                allDone={wrappingUp || closingOrDone}
                topicLabel={t("interview.currentTopic")}
                topic={currentQuestion?.topic}
                hint={t("interview.thinkAloud")}
              />
            )}
            {isForest && monitoringOn ? (
              <ForestIntegrity
                title={t("forestRoom.monitorTitle")}
                body={forestMonitorBody}
                count={
                  exitCount > 0
                    ? t("forestRoom.monitorExits", { n: exitCount })
                    : undefined
                }
                countWarn={exitCount >= 3}
                sync={syncState}
                syncLabel={t(`interview.sync_${syncState}`)}
              />
            ) : null}
          </div>
        </div>
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
                className={isForest ? "fr-banner" : "card"}
                data-kind={isForest ? banner : undefined}
                style={isForest ? undefined : {
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
                    style={isForest ? undefined : { padding: "10px 14px", fontSize: 13 }}
                    onClick={() => setBanner(null)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className={
                      isForest && banner === "skip"
                        ? "btn fr-btn-danger"
                        : "btn btn-primary"
                    }
                    style={isForest ? undefined : {
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
          {isForest ? (
            <div className="fr-dock">
              <div className="fr-dock-mic">
                {isLive && wrappingUp ? (
                  <div className="fr-dock-farewell">
                    <Spinner forest />
                    <span>{t("interview.farewell")}</span>
                  </div>
                ) : isLive ? (
                  <>
                    <button
                      type="button"
                      onClick={toggleMute}
                      aria-label={
                        muted ? t("interview.unmute") : t("interview.mute")
                      }
                      aria-pressed={muted}
                      className="fr-mic"
                      data-muted={muted ? "true" : undefined}
                      style={{
                        ["--lvl" as string]: muted
                          ? 0
                          : Math.min(1, userLevel * 4).toFixed(3),
                      }}
                    >
                      {muted ? <MicOffIcon size={24} /> : <MicIcon size={24} />}
                    </button>
                    <div className="fr-mic-status">
                      <span
                        className="fr-mic-label"
                        data-tone={muted ? "off" : "on"}
                      >
                        <span className="fr-dot" aria-hidden />
                        {muted ? t("forestRoom.micMuted") : t("forestRoom.micOn")}
                      </span>
                      <span className="fr-mic-hint">
                        {muted
                          ? t("interview.spaceToUnmute")
                          : t("interview.spaceToMute")}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <MicButton
                      recording={recording}
                      size={56}
                      className="fr-mic"
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
                      {recording ? <StopIcon size={22} /> : <MicIcon size={24} />}
                    </MicButton>
                    <div className="fr-mic-status">
                      <span
                        className="fr-mic-label"
                        data-tone={
                          recording
                            ? "rec"
                            : session.state === "student_turn"
                              ? "on"
                              : "off"
                        }
                      >
                        <span className="fr-dot" aria-hidden />
                        {recording
                          ? t("forestRoom.micRecording")
                          : session.state === "student_turn"
                            ? t("forestRoom.micReady")
                            : t("forestRoom.micIdle")}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary fr-dock-primary"
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

              <div className="fr-dock-actions">
                <button
                  type="button"
                  className="btn btn-secondary fr-act"
                  onClick={() => setPaused((p) => !p)}
                  aria-label={paused ? t("interview.resume") : t("interview.pause")}
                >
                  {paused ? <PlayIcon size={16} /> : <PauseIcon size={16} />}
                  <span>{paused ? t("interview.resume") : t("interview.pause")}</span>
                </button>
                {!wrappingUp && !closingOrDone ? (
                  <>
                    <button
                      type="button"
                      className="btn btn-secondary fr-act"
                      onClick={() => setBanner("skip")}
                      disabled={controlsLocked}
                      aria-label={t("interview.skipQuestion")}
                    >
                      <span className="icon-flip fr-act-icon">
                        <SkipIcon size={18} />
                      </span>
                      <span className="fr-act-long">{t("interview.skipQuestion")}</span>
                      <span className="fr-act-short" aria-hidden>
                        {t("forestRoom.skipShort")}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary fr-act"
                      onClick={() => setBanner("replace")}
                      disabled={controlsLocked || replaceUsed}
                      aria-label={
                        replaceUsed
                          ? t("interview.replaceUsed")
                          : t("interview.replaceQuestion")
                      }
                    >
                      <RefreshIcon size={18} className="fr-act-icon" />
                      <span className="fr-act-long">
                        {replaceUsed
                          ? t("interview.replaceUsed")
                          : t("interview.replaceQuestion")}
                      </span>
                      <span className="fr-act-short" aria-hidden>
                        {replaceUsed
                          ? t("forestRoom.swapUsedShort")
                          : t("forestRoom.swapShort")}
                      </span>
                    </button>
                  </>
                ) : null}
              </div>

              <div className="fr-dock-end">
                {!(isLive && wrappingUp) ? (
                  <button
                    type="button"
                    className="btn fr-end"
                    onClick={handleEndEarly}
                    aria-label={t("forestRoom.endConversation")}
                  >
                    <StopIcon size={16} />
                    <span className="fr-act-long">{t("forestRoom.endConversation")}</span>
                    <span className="fr-act-short" aria-hidden>
                      {t("forestRoom.endShort")}
                    </span>
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
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
                      className="room-mic"
                      style={{
                        ["--lvl" as string]: muted
                          ? 0
                          : Math.min(1, userLevel * 4).toFixed(3),
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
          )}
        </div>
      </div>

      <audio ref={audioRef} hidden playsInline />

      {adapterError && (
        <div
          role="alert"
          className={isForest ? "fr-error" : undefined}
          style={isForest ? undefined : {
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
          <div>
            {adapterError === "at_capacity"
              ? t("interview.atCapacity")
              : `${t("interview.connectionError")}: ${adapterError}`}
          </div>
          <div
            className={isForest ? "fr-error-hint" : "text-muted"}
            style={isForest ? undefined : { fontSize: 12, marginTop: 6, color: "#9F1239" }}
          >
            {t("interview.reconnectHint")}
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            style={isForest ? undefined : { marginTop: 10, padding: "8px 12px", fontSize: 12 }}
            onClick={() => window.location.reload()}
          >
            {t("interview.reconnectPage")}
          </button>
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
            className={isForest ? "fr-overlay" : undefined}
            style={isForest ? undefined : {
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
              className={isForest ? "card fr-overlay-card" : "card"}
              style={isForest ? undefined : {
                padding: "32px 40px",
                borderRadius: 24,
                background: "rgba(255,255,255,0.98)",
                display: "flex",
                alignItems: "center",
                gap: 18,
                boxShadow: "0 30px 80px rgba(15,23,42,0.25)",
              }}
            >
              <Spinner forest={isForest} />
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

