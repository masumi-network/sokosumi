import { describe, expect, it } from "vitest";

import type { Coworker } from "@/app/chat/utils/types";

import { createInitialOnboardingState, reduceOnboarding } from "../machine";
import type { DraftLabelBundle } from "../types";

const coworker: Coworker = {
  id: "elena-id",
  slug: "elena",
  name: "Elena",
  description: "",
  useCase: "",
  capabilities: ["chat"],
  canChat: true,
};

const draftLabels: DraftLabelBundle = {
  intentLabel: "Chat",
  goalFallbackLabel: "help",
  composeDraft: ({ intentLabel, goalText }) => goalText ?? intentLabel,
};

describe("reduceOnboarding", () => {
  it("starts on intent questionnaire", () => {
    const state = createInitialOnboardingState();
    expect(state.phase.kind).toBe("questionnaire");
    if (state.phase.kind === "questionnaire") {
      expect(state.phase.stepId).toBe("intent");
    }
  });

  it("advances intent → goal → confirm with recommendation", () => {
    let state = createInitialOnboardingState();
    state = reduceOnboarding(state, {
      type: "answer_step",
      stepId: "intent",
      value: { kind: "single", choiceId: "chat" },
    });
    state = reduceOnboarding(state, {
      type: "advance",
      coworkers: [coworker],
      draftLabels,
    });
    expect(state.phase.kind).toBe("questionnaire");
    if (state.phase.kind === "questionnaire") {
      expect(state.phase.stepId).toBe("goal");
    }

    state = reduceOnboarding(state, {
      type: "answer_step",
      stepId: "goal",
      value: { kind: "freeform", text: "Ship weekly update" },
    });
    state = reduceOnboarding(state, {
      type: "advance",
      coworkers: [coworker],
      draftLabels,
    });

    expect(state.phase.kind).toBe("confirm");
    if (state.phase.kind === "confirm") {
      expect(state.phase.selectedCoworkerId).toBe("elena-id");
      expect(state.phase.recommendation.draftText).toBe("Ship weekly update");
    }
  });

  it("confirm_failed returns to confirm with error", () => {
    let state = createInitialOnboardingState();
    state = reduceOnboarding(state, {
      type: "answer_step",
      stepId: "intent",
      value: { kind: "single", choiceId: "chat" },
    });
    state = reduceOnboarding(state, {
      type: "advance",
      coworkers: [coworker],
      draftLabels,
    });
    state = reduceOnboarding(state, {
      type: "answer_step",
      stepId: "goal",
      value: { kind: "skipped" },
    });
    state = reduceOnboarding(state, {
      type: "advance",
      coworkers: [coworker],
      draftLabels,
    });
    state = reduceOnboarding(state, { type: "confirm_start" });
    expect(state.phase.kind).toBe("opening");

    state = reduceOnboarding(state, {
      type: "confirm_failed",
      error: { kind: "ensure_failed", message: "nope" },
    });
    expect(state.phase.kind).toBe("confirm");
    if (state.phase.kind === "confirm") {
      expect(state.phase.lastError?.message).toBe("nope");
    }
  });

  it("stores preferredCoworkerSlug from try-asking freeform", () => {
    let state = createInitialOnboardingState();
    state = reduceOnboarding(state, {
      type: "answer_step",
      stepId: "intent",
      value: { kind: "single", choiceId: "either" },
    });
    state = reduceOnboarding(state, {
      type: "advance",
      coworkers: [coworker],
      draftLabels,
    });
    state = reduceOnboarding(state, {
      type: "answer_step",
      stepId: "goal",
      value: {
        kind: "freeform",
        text: "Help me figure out Sokosumi",
        preferredCoworkerSlug: "elena",
      },
    });
    state = reduceOnboarding(state, {
      type: "advance",
      coworkers: [coworker],
      draftLabels,
    });

    expect(state.phase.kind).toBe("confirm");
    if (state.phase.kind === "confirm") {
      expect(state.phase.answers.preferredCoworkerSlug).toBe("elena");
      expect(state.phase.recommendation.draftText).toBe(
        "Help me figure out Sokosumi",
      );
    }
  });
});
