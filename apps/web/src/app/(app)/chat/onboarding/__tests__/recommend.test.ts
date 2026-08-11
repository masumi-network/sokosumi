import { describe, expect, it } from "vitest";

import type { Coworker } from "@/app/chat/utils/types";

import { chatCapableCoworkers, recommendFromAnswers } from "../recommend";
import type { DraftLabelBundle } from "../types";

function coworker(
  partial: Partial<Coworker> & Pick<Coworker, "id" | "slug">,
): Coworker {
  return {
    name: partial.name ?? partial.slug,
    description: "",
    useCase: "",
    capabilities: partial.capabilities ?? ["chat"],
    canChat: partial.canChat,
    archivedAt: partial.archivedAt ?? null,
    ...partial,
  };
}

const draftLabels: DraftLabelBundle = {
  intentLabel: "Chat",
  goalFallbackLabel: "general help",
  composeDraft: ({ intentLabel, goalText }) =>
    goalText ? `Goal: ${goalText}` : `Intent: ${intentLabel}`,
};

describe("recommendFromAnswers", () => {
  it("prefers chat-capable coworker for chat intent", () => {
    const coworkers = [
      coworker({
        id: "task-1",
        slug: "alex",
        capabilities: ["tasks"],
        canChat: false,
      }),
      coworker({
        id: "chat-1",
        slug: "elena",
        capabilities: ["chat"],
        canChat: true,
      }),
    ];

    const result = recommendFromAnswers({
      answers: { intent: "chat" },
      coworkers,
      draftLabels,
    });

    expect(result.coworkerId).toBe("chat-1");
    expect(result.filterCapability).toBe("chat");
    expect(result.draftText).toBe("Intent: Chat");
  });

  it("prefers tasks-capable coworker for tasks intent", () => {
    const coworkers = [
      coworker({
        id: "chat-1",
        slug: "elena",
        capabilities: ["chat"],
        canChat: true,
      }),
      coworker({
        id: "task-1",
        slug: "alex",
        capabilities: ["tasks"],
        canChat: false,
      }),
    ];

    const result = recommendFromAnswers({
      answers: { intent: "tasks", goal: "  Weekly update  " },
      coworkers,
      draftLabels,
    });

    expect(result.coworkerId).toBe("task-1");
    expect(result.filterCapability).toBe("tasks");
    expect(result.draftText).toBe("Goal: Weekly update");
  });

  it("either prefers chat when available", () => {
    const coworkers = [
      coworker({
        id: "task-1",
        slug: "alex",
        capabilities: ["tasks"],
        canChat: false,
      }),
      coworker({
        id: "chat-1",
        slug: "elena",
        capabilities: ["chat"],
        canChat: true,
      }),
    ];

    const result = recommendFromAnswers({
      answers: { intent: "either" },
      coworkers,
      draftLabels,
    });

    expect(result.coworkerId).toBe("chat-1");
    expect(result.filterCapability).toBe("chat");
  });

  it("falls back to findDefaultCoworker among filtered (elena preferred)", () => {
    const coworkers = [
      coworker({
        id: "hannah-id",
        slug: "hannah",
        capabilities: ["chat"],
        canChat: true,
      }),
      coworker({
        id: "elena-id",
        slug: "elena",
        capabilities: ["chat"],
        canChat: true,
      }),
    ];

    const result = recommendFromAnswers({
      answers: { intent: "chat" },
      coworkers,
      draftLabels,
    });

    expect(result.coworkerId).toBe("elena-id");
  });
  it("pins coworker from preferredCoworkerSlug (try-asking sample)", () => {
    const coworkers = [
      coworker({
        id: "elena-id",
        slug: "elena",
        capabilities: ["chat"],
        canChat: true,
      }),
      coworker({
        id: "alex-id",
        slug: "alex",
        capabilities: ["chat"],
        canChat: true,
      }),
    ];

    const result = recommendFromAnswers({
      answers: {
        intent: "either",
        goal: "Build me a dashboard for my research results.",
        preferredCoworkerSlug: "alex",
      },
      coworkers,
      draftLabels,
    });

    expect(result.coworkerId).toBe("alex-id");
    expect(result.draftText).toBe(
      "Goal: Build me a dashboard for my research results.",
    );
  });

  it("either without sample still prefers Elena via findDefaultCoworker", () => {
    const coworkers = [
      coworker({
        id: "hannah-id",
        slug: "hannah",
        capabilities: ["chat"],
        canChat: true,
      }),
      coworker({
        id: "elena-id",
        slug: "elena",
        capabilities: ["chat"],
        canChat: true,
      }),
    ];

    const result = recommendFromAnswers({
      answers: { intent: "either" },
      coworkers,
      draftLabels,
    });

    expect(result.coworkerId).toBe("elena-id");
  });
});

describe("chatCapableCoworkers", () => {
  it("filters to chat-capable only", () => {
    const coworkers = [
      coworker({
        id: "a",
        slug: "a",
        canChat: true,
        capabilities: ["chat"],
      }),
      coworker({
        id: "b",
        slug: "b",
        canChat: false,
        capabilities: ["tasks"],
      }),
    ];
    expect(chatCapableCoworkers(coworkers).map((c) => c.id)).toEqual(["a"]);
  });
});
