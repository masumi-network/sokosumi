import {
  type CoworkerCapability,
  coworkerCanChat,
  coworkerCanHandleTasks,
  findCoworkerBySlugOrId,
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

function findPreferredCoworker(
  preferredSlug: string | undefined,
  pools: readonly (readonly Coworker[])[],
): Coworker | null {
  const preferred = preferredSlug?.trim();
  if (!preferred) {
    return null;
  }
  for (const pool of pools) {
    if (pool.length === 0) {
      continue;
    }
    const found = findCoworkerBySlugOrId([...pool], preferred);
    if (found) {
      return found;
    }
  }
  return null;
}

/**
 * Pure mapper. Confirm always opens a DM, so the pick is always chat-capable.
 * Prefer intent-matching ∩ chat (tasks→tasks+chat, chat→chat, either→chat then
 * tasks). preferredCoworkerSlug pins when found in those chat pools. Else
 * findDefaultCoworker. Draft from goal freeform or intent label via
 * DraftLabelBundle.
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
  // Intent pool may include tasks-only coworkers; intersect with chat so
  // selectedCoworkerId matches ConfirmStep's chat-only gallery / ensure DM.
  const intentAndChat = filtered.filter(coworkerCanChat);
  const pool =
    intentAndChat.length > 0
      ? intentAndChat
      : chatCapable.length > 0
        ? chatCapable
        : [];

  const preferred = findPreferredCoworker(answers.preferredCoworkerSlug, [
    intentAndChat,
    chatCapable,
  ]);
  const picked = preferred ?? findDefaultCoworker(pool);
  const coworkerId = picked?.id ?? "";

  const goalText = answers.goal?.trim() ? answers.goal.trim() : null;
  const draftText = draftLabels.composeDraft({ goalText });

  return {
    coworkerId,
    draftText,
    filterCapability:
      intentAndChat.length > 0
        ? filterCapability
        : chatCapable.length > 0
          ? "chat"
          : "any",
  };
}
