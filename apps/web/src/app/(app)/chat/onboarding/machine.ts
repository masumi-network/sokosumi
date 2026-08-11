import { getStepDef, isIntentChoiceId } from "./questions";
import { recommendFromAnswers } from "./recommend";
import type {
  IntentChoiceId,
  OnboardingAnswers,
  OnboardingEvent,
  OnboardingState,
  PartialOnboardingAnswers,
  StepAnswerValue,
} from "./types";

export type { OnboardingEvent } from "./types";

export function createInitialOnboardingState(): OnboardingState {
  return {
    phase: {
      kind: "questionnaire",
      stepId: "intent",
      answers: {},
    },
  };
}

function mergeAnswer(
  answers: PartialOnboardingAnswers,
  stepId: "intent" | "goal",
  value: StepAnswerValue,
): PartialOnboardingAnswers {
  if (stepId === "intent") {
    if (value.kind === "single" && isIntentChoiceId(value.choiceId)) {
      return { ...answers, intent: value.choiceId };
    }
    return answers;
  }

  if (value.kind === "freeform") {
    const trimmed = value.text.trim();
    if (!trimmed) {
      const next = { ...answers };
      delete next.goal;
      delete next.preferredCoworkerSlug;
      return next;
    }
    const next: PartialOnboardingAnswers = { ...answers, goal: trimmed };
    const preferred = value.preferredCoworkerSlug?.trim();
    if (preferred) {
      next.preferredCoworkerSlug = preferred;
    } else {
      delete next.preferredCoworkerSlug;
    }
    return next;
  }
  if (value.kind === "skipped") {
    const next = { ...answers };
    delete next.goal;
    delete next.preferredCoworkerSlug;
    return next;
  }
  return answers;
}

function toCompleteAnswers(
  answers: PartialOnboardingAnswers,
): OnboardingAnswers | null {
  if (!answers.intent) {
    return null;
  }
  const complete: OnboardingAnswers = { intent: answers.intent };
  if (answers.goal) {
    complete.goal = answers.goal;
  }
  if (answers.preferredCoworkerSlug) {
    complete.preferredCoworkerSlug = answers.preferredCoworkerSlug;
  }
  return complete;
}

function previousStepId(stepId: "intent" | "goal"): "intent" | "goal" | null {
  if (stepId === "goal") {
    return "intent";
  }
  return null;
}

/**
 * Pure reducer. Idempotent where safe:
 * - answer_step on same step replaces value
 * - confirm_start from non-confirm is no-op
 * - confirm_failed from non-opening returns state unchanged
 */
export function reduceOnboarding(
  state: OnboardingState,
  event: OnboardingEvent,
): OnboardingState {
  switch (event.type) {
    case "answer_step": {
      if (state.phase.kind !== "questionnaire") {
        return state;
      }
      if (state.phase.stepId !== event.stepId) {
        return state;
      }
      return {
        phase: {
          ...state.phase,
          answers: mergeAnswer(state.phase.answers, event.stepId, event.value),
        },
      };
    }

    case "advance": {
      if (state.phase.kind !== "questionnaire") {
        return state;
      }
      const step = getStepDef(state.phase.stepId);
      if (step.required) {
        if (state.phase.stepId === "intent" && !state.phase.answers.intent) {
          return state;
        }
      }

      const nextId = step.next(state.phase.answers);
      if (nextId != null) {
        return {
          phase: {
            kind: "questionnaire",
            stepId: nextId,
            answers: state.phase.answers,
          },
        };
      }

      const complete = toCompleteAnswers(state.phase.answers);
      if (!complete) {
        return state;
      }

      const recommendation = recommendFromAnswers({
        answers: complete,
        coworkers: event.coworkers,
        draftLabels: event.draftLabels,
      });

      return {
        phase: {
          kind: "confirm",
          answers: complete,
          recommendation,
          selectedCoworkerId: recommendation.coworkerId,
        },
      };
    }

    case "back": {
      if (state.phase.kind === "questionnaire") {
        const prev = previousStepId(state.phase.stepId);
        if (!prev) {
          return state;
        }
        return {
          phase: {
            kind: "questionnaire",
            stepId: prev,
            answers: state.phase.answers,
          },
        };
      }
      if (state.phase.kind === "confirm") {
        return {
          phase: {
            kind: "questionnaire",
            stepId: "goal",
            answers: {
              intent: state.phase.answers.intent,
              ...(state.phase.answers.goal
                ? { goal: state.phase.answers.goal }
                : {}),
              ...(state.phase.answers.preferredCoworkerSlug
                ? {
                    preferredCoworkerSlug:
                      state.phase.answers.preferredCoworkerSlug,
                  }
                : {}),
            },
          },
        };
      }
      return state;
    }

    case "select_coworker": {
      if (state.phase.kind !== "confirm") {
        return state;
      }
      return {
        phase: {
          ...state.phase,
          selectedCoworkerId: event.coworkerId,
          lastError: undefined,
        },
      };
    }

    case "confirm_start": {
      if (state.phase.kind !== "confirm") {
        return state;
      }
      return {
        phase: {
          kind: "opening",
          answers: state.phase.answers,
          recommendation: state.phase.recommendation,
          selectedCoworkerId: state.phase.selectedCoworkerId,
        },
      };
    }

    case "confirm_failed": {
      if (state.phase.kind !== "opening") {
        return state;
      }
      return {
        phase: {
          kind: "confirm",
          answers: state.phase.answers,
          recommendation: state.phase.recommendation,
          selectedCoworkerId: state.phase.selectedCoworkerId,
          lastError: event.error,
        },
      };
    }

    case "confirm_succeeded": {
      return state;
    }

    default: {
      return state;
    }
  }
}

/** Resolve intent label key for i18n. */
export function intentChoiceLabelKey(intent: IntentChoiceId): string {
  return `intentChoices.${intent}`;
}
