import type { CoworkerCapability } from "@/app/chat/utils/coworker-utils";
import type { Coworker } from "@/app/chat/utils/types";

/** Closed set of onboarding step ids (web-only tree). */
export type OnboardingStepId = "intent" | "goal";

export type IntentChoiceId = "chat" | "tasks" | "either";

export type StepAnswerValue =
  | { kind: "single"; choiceId: string }
  | { kind: "multi"; choiceIds: readonly string[] }
  | { kind: "freeform"; text: string }
  | { kind: "skipped" };

/** Accumulated answers; required fields only after questionnaire completes. */
export interface PartialOnboardingAnswers {
  intent?: IntentChoiceId;
  goal?: string;
}

export interface OnboardingAnswers {
  intent: IntentChoiceId;
  goal?: string;
}

export interface OnboardingRecommendation {
  coworkerId: string;
  draftText: string;
  /** Capability used to filter before default/fallback pick. */
  filterCapability: CoworkerCapability | "any";
}

export type OnboardingPhase =
  | {
      kind: "questionnaire";
      stepId: OnboardingStepId;
      answers: PartialOnboardingAnswers;
    }
  | {
      kind: "confirm";
      answers: OnboardingAnswers;
      recommendation: OnboardingRecommendation;
      /** May differ from recommendation.coworkerId after user switch. */
      selectedCoworkerId: string;
      lastError?: OnboardingConfirmError;
    }
  | {
      kind: "opening";
      answers: OnboardingAnswers;
      recommendation: OnboardingRecommendation;
      selectedCoworkerId: string;
    };

export interface OnboardingState {
  phase: OnboardingPhase;
}

export interface OnboardingConfirmError {
  message: string;
  /** Stable kind for tests; toast uses message. */
  kind: "ensure_failed" | "no_chat_coworker" | "unknown";
}

export interface DraftLabelBundle {
  /** Resolved choice label for intent (and any future choice steps). */
  intentLabel: string;
  goalFallbackLabel: string;
  /** Template fn — keep i18n at host, pure join here. */
  composeDraft: (parts: {
    intentLabel: string;
    goalText: string | null;
  }) => string;
}

export interface QuestionStepDef {
  id: OnboardingStepId;
  kind: "single" | "freeform";
  /** When false, step omitted (e.g. goal always optional via skip). */
  required: boolean;
  /** Branch: return next step id or null if questionnaire done. */
  next: (answers: PartialOnboardingAnswers) => OnboardingStepId | null;
}

export type OnboardingEvent =
  | {
      type: "answer_step";
      stepId: OnboardingStepId;
      value: StepAnswerValue;
    }
  | {
      type: "advance";
      coworkers: readonly Coworker[];
      draftLabels: DraftLabelBundle;
    }
  | { type: "back" }
  | { type: "select_coworker"; coworkerId: string }
  | { type: "confirm_start" }
  | { type: "confirm_failed"; error: OnboardingConfirmError }
  | { type: "confirm_succeeded" };
