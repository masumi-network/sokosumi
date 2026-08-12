import type {
  OnboardingStepId,
  PartialOnboardingAnswers,
  QuestionStepDef,
} from "./types";

/** Fixed web tree: intent → optional goal → done. */
export const ONBOARDING_QUESTION_TREE: readonly QuestionStepDef[] = [
  {
    id: "intent",
    kind: "single",
    required: true,
    next: () => "goal",
  },
  {
    id: "goal",
    kind: "freeform",
    required: false,
    next: () => null,
  },
];

export function getStepDef(stepId: OnboardingStepId): QuestionStepDef {
  const step = ONBOARDING_QUESTION_TREE.find((entry) => entry.id === stepId);
  if (!step) {
    throw new Error(`Unknown onboarding step: ${stepId}`);
  }
  return step;
}

export function stepIndex(stepId: OnboardingStepId): number {
  return ONBOARDING_QUESTION_TREE.findIndex((entry) => entry.id === stepId);
}

export function isIntentChoiceId(
  value: string,
): value is NonNullable<PartialOnboardingAnswers["intent"]> {
  return value === "chat" || value === "tasks" || value === "either";
}
