"use client";

import { useEffect, useReducer, useRef } from "react";
import {
  completeInterview,
  saveInterviewMessage,
} from "@/lib/student/student-service";
import type { InterviewRuntimeState } from "@/lib/student/status";
import type { StudentInterviewQuestion } from "@/lib/student/types";

export type InterviewEvent =
  | { type: "CONNECT" }
  | { type: "CONNECTED" }
  | { type: "HOST_INTRO_DONE" }
  | { type: "AI_FINISHED_SPEAKING" }
  | { type: "AI_STARTED_SPEAKING" }
  | { type: "STUDENT_START_RECORDING" }
  | { type: "STUDENT_FINISH_RECORDING"; transcript?: string }
  | { type: "TRANSCRIBED" }
  | { type: "EVALUATED" }
  | { type: "NEXT_QUESTION" }
  | { type: "SET_QUESTION_INDEX"; index: number }
  | { type: "CLOSE" }
  | { type: "FAIL"; reason: string };

export interface InterviewSessionState {
  state: InterviewRuntimeState;
  questionIndex: number;
  // Captured once at mount from the `questions` option by design; the plan
  // does not change during a session.
  totalQuestions: number;
  startedAt: number | null;
  failureReason?: string;
}

const TRANSITIONS: Record<
  InterviewRuntimeState,
  Partial<Record<InterviewEvent["type"], InterviewRuntimeState>>
> = {
  idle: { CONNECT: "connecting" },
  connecting: { CONNECTED: "host_intro", FAIL: "failed" },
  host_intro: {
    HOST_INTRO_DONE: "ai_speaking",
    AI_STARTED_SPEAKING: "ai_speaking",
    AI_FINISHED_SPEAKING: "student_turn",
    SET_QUESTION_INDEX: "ai_speaking",
    CLOSE: "closing",
    FAIL: "failed",
  },
  ai_speaking: {
    AI_FINISHED_SPEAKING: "student_turn",
    SET_QUESTION_INDEX: "ai_speaking",
    CLOSE: "closing",
    FAIL: "failed",
  },
  student_turn: {
    STUDENT_START_RECORDING: "student_recording",
    AI_STARTED_SPEAKING: "ai_speaking",
    SET_QUESTION_INDEX: "ai_speaking",
    CLOSE: "closing",
    FAIL: "failed",
  },
  student_recording: {
    STUDENT_FINISH_RECORDING: "transcribing",
    AI_STARTED_SPEAKING: "ai_speaking",
    SET_QUESTION_INDEX: "ai_speaking",
    CLOSE: "closing",
    FAIL: "failed",
  },
  transcribing: {
    TRANSCRIBED: "evaluating_answer",
    AI_STARTED_SPEAKING: "ai_speaking",
    SET_QUESTION_INDEX: "ai_speaking",
    CLOSE: "closing",
    FAIL: "failed",
  },
  evaluating_answer: {
    EVALUATED: "followup",
    AI_STARTED_SPEAKING: "ai_speaking",
    SET_QUESTION_INDEX: "ai_speaking",
    CLOSE: "closing",
    FAIL: "failed",
  },
  followup: {
    NEXT_QUESTION: "ai_speaking",
    AI_STARTED_SPEAKING: "ai_speaking",
    SET_QUESTION_INDEX: "ai_speaking",
    CLOSE: "closing",
    FAIL: "failed",
  },
  closing: { CLOSE: "completed" },
  completed: {},
  failed: {},
};

function reducer(
  state: InterviewSessionState,
  event: InterviewEvent,
): InterviewSessionState {
  const next = TRANSITIONS[state.state]?.[event.type];
  if (!next) return state;

  switch (event.type) {
    case "CONNECT":
      return { ...state, state: next, startedAt: Date.now() };
    case "NEXT_QUESTION":
      if (state.questionIndex >= state.totalQuestions - 1) {
        return { ...state, state: "closing" };
      }
      return { ...state, state: next, questionIndex: state.questionIndex + 1 };
    case "SET_QUESTION_INDEX": {
      const max = Math.max(0, state.totalQuestions - 1);
      const clamped = Math.min(max, Math.max(0, Math.floor(event.index)));
      return { ...state, state: next, questionIndex: clamped };
    }
    case "FAIL":
      return { ...state, state: "failed", failureReason: event.reason };
    default:
      return { ...state, state: next };
  }
}

export type InterviewAdapterMode = "mock" | "openai";

export interface UseInterviewSessionOptions {
  interviewId: string;
  questions: StudentInterviewQuestion[];
  mode?: InterviewAdapterMode;
  onCompleted?: (durationSeconds: number) => void;
}

export function useInterviewSession({
  interviewId,
  questions,
  mode = "mock",
  onCompleted,
}: UseInterviewSessionOptions) {
  const [state, dispatch] = useReducer(reducer, {
    state: "idle" as InterviewRuntimeState,
    questionIndex: 0,
    totalQuestions: questions.length,
    startedAt: null,
  });

  const completedRef = useRef(false);

  // Track which planned question is currently in flight so persisted
  // messages can be grouped by question for the rubric model. This is the
  // id of the plan entry, not the index.
  const currentPlanQuestionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const q = questions[state.questionIndex];
    currentPlanQuestionIdRef.current = q?.id ?? null;
  }, [questions, state.questionIndex]);

  // Mock-mode auto-driver: walks the state machine on timers so we can run
  // the UI without a real Realtime connection. In OpenAI mode the adapter is
  // responsible for dispatching state transitions from its event stream.
  useEffect(() => {
    if (mode !== "mock") return;
    if (state.state === "ai_speaking") {
      const question = questions[state.questionIndex];
      if (question) {
        void saveInterviewMessage({
          interviewId,
          speaker: "ai_host",
          messageType: "question",
          content: question.question,
          planQuestionId: question.id,
        });
      }
      const t = setTimeout(() => dispatch({ type: "AI_FINISHED_SPEAKING" }), 2400);
      return () => clearTimeout(t);
    }
    if (state.state === "host_intro") {
      const t = setTimeout(() => dispatch({ type: "HOST_INTRO_DONE" }), 1600);
      return () => clearTimeout(t);
    }
    if (state.state === "transcribing") {
      const t = setTimeout(() => dispatch({ type: "TRANSCRIBED" }), 1000);
      return () => clearTimeout(t);
    }
    if (state.state === "evaluating_answer") {
      const t = setTimeout(() => dispatch({ type: "EVALUATED" }), 1100);
      return () => clearTimeout(t);
    }
  }, [state, questions, interviewId, mode]);

  // Completion side effect runs in either mode the moment we enter `closing`.
  // The redirect (`onCompleted`) fires immediately so the student lands on
  // the report page right away; the Supabase write runs in the background
  // and is allowed to fail — the destination page polls for the report
  // independently and renders a "scoring…" placeholder while it waits.
  useEffect(() => {
    if (state.state !== "closing") return;
    if (completedRef.current) return;
    completedRef.current = true;
    const duration = state.startedAt
      ? Math.round((Date.now() - state.startedAt) / 1000)
      : 0;
    onCompleted?.(duration);
    void completeInterview(interviewId, duration).catch(() => {
      // Errors are already surfaced server-side via system_events; the
      // /complete page tolerates a partial server view.
    });
  }, [state.state, state.startedAt, interviewId, onCompleted]);

  return {
    state: state.state,
    questionIndex: state.questionIndex,
    currentQuestion: questions[state.questionIndex],
    totalQuestions: state.totalQuestions,
    failureReason: state.failureReason,
    connect: () => dispatch({ type: "CONNECT" }),
    confirmConnected: () => dispatch({ type: "CONNECTED" }),
    aiStartedSpeaking: () => dispatch({ type: "AI_STARTED_SPEAKING" }),
    aiFinishedSpeaking: () => dispatch({ type: "AI_FINISHED_SPEAKING" }),
    startRecording: () => dispatch({ type: "STUDENT_START_RECORDING" }),
    finishRecording: (transcript?: string, opts?: { persist?: boolean }) => {
      if (opts?.persist !== false) {
        void saveInterviewMessage({
          interviewId,
          speaker: "student",
          messageType: "answer",
          content: transcript ?? "(audio answer)",
          planQuestionId: currentPlanQuestionIdRef.current,
        });
      }
      dispatch({ type: "STUDENT_FINISH_RECORDING", transcript });
    },
    persistAssistantMessage: (text: string) => {
      void saveInterviewMessage({
        interviewId,
        speaker: "ai_host",
        messageType: "question",
        content: text,
        planQuestionId: currentPlanQuestionIdRef.current,
      });
    },
    persistStudentMessage: (text: string) => {
      void saveInterviewMessage({
        interviewId,
        speaker: "student",
        messageType: "answer",
        content: text,
        planQuestionId: currentPlanQuestionIdRef.current,
      });
    },
    nextQuestion: () => dispatch({ type: "NEXT_QUESTION" }),
    setQuestionIndex: (index: number) =>
      dispatch({ type: "SET_QUESTION_INDEX", index }),
    close: () => dispatch({ type: "CLOSE" }),
    fail: (reason: string) => dispatch({ type: "FAIL", reason }),
  };
}
