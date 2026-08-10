import {
  type CoworkerCapability,
  coworkerCanChat,
  coworkerCanHandleTasks,
  findDefaultCoworker,
} from "@/app/chat/utils/coworker-utils";
import type { Coworker } from "@/app/chat/utils/types";

import type {
  DraftLabelBundle,
  OnboardingAnswers,
  OnboardingRecommendation,
} from "./types";

export function chatCapableCoworkers(
  coworkers: readonly Coworker[],
): Coworker[] {
  return coworkers.filter(coworkerCanChat);
}

function filterByIntent(
  coworkers: readonly Coworker[],
  intent: OnboardingAnswers["intent"],
): { filtered: Coworker[]; filterCapability: CoworkerCapability | "any" } {
  if (intent === "chat") {
    return {
      filtered: coworkers.filter(coworkerCanChat),
      filterCapability: "chat",
    };
  }
  if (intent === "tasks") {
    return {
      filtered: coworkers.filter(coworkerCanHandleTasks),
      filterCapability: "tasks",
    };
  }

  const chatCapable = coworkers.filter(coworkerCanChat);
  if (chatCapable.length > 0) {
    return { filtered: chatCapable, filterCapability: "chat" };
  }
  return {
    filtered: coworkers.filter(coworkerCanHandleTasks),
    filterCapability: "tasks",
  };
}

/**
 * Pure mapper. Prefer chat-capable for chat intent; tasks-capable for tasks;
 * either → prefer chat then tasks. Fallback findDefaultCoworker among filtered.
 * Draft from goal freeform or intent label via DraftLabelBundle.
 */
export function recommendFromAnswers(input: {
  answers: OnboardingAnswers;
  coworkers: readonly Coworker[];
  draftLabels: DraftLabelBundle;
}): OnboardingRecommendation {
  const { answers, coworkers, draftLabels } = input;
  const { filtered, filterCapability } = filterByIntent(
    coworkers,
    answers.intent,
  );

  const chatCapable = chatCapableCoworkers(coworkers);
  const pool =
    filtered.length > 0
      ? filtered
      : chatCapable.length > 0
        ? chatCapable
        : [...coworkers];

  const picked = findDefaultCoworker(pool);
  const coworkerId = picked?.id ?? "";

  const goalText = answers.goal?.trim() ? answers.goal.trim() : null;
  const draftText = draftLabels.composeDraft({
    intentLabel: draftLabels.intentLabel,
    goalText,
  });

  return {
    coworkerId,
    draftText,
    filterCapability:
      filtered.length > 0
        ? filterCapability
        : chatCapable.length > 0
          ? "chat"
          : "any",
  };
}
