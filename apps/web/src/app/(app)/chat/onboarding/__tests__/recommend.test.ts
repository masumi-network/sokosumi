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
  composeDraft: ({ goalText }) =>
    goalText ? `Goal: ${goalText}` : "Skipped draft",
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
    expect(result.draftText).toBe("Skipped draft");
  });

  it("prefers tasks+chat coworker for tasks intent (never tasks-only)", () => {
    const coworkers = [
      coworker({
        id: "chat-only",
        slug: "elena",
        capabilities: ["chat"],
        canChat: true,
      }),
      coworker({
        id: "tasks-only",
        slug: "tasky",
        capabilities: ["tasks"],
        canChat: false,
      }),
      coworker({
        id: "tasks-and-chat",
        slug: "alex",
        capabilities: ["tasks", "chat"],
        canChat: true,
      }),
    ];

    const result = recommendFromAnswers({
      answers: { intent: "tasks", goal: "  Weekly update  " },
      coworkers,
      draftLabels,
    });

    expect(result.coworkerId).toBe("tasks-and-chat");
    expect(result.filterCapability).toBe("tasks");
    expect(result.draftText).toBe("Goal: Weekly update");
  });

  it("falls back to chat-capable when tasks intent has no tasks+chat coworker", () => {
    const coworkers = [
      coworker({
        id: "tasks-only",
        slug: "tasky",
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
      answers: { intent: "tasks", goal: "Weekly update" },
      coworkers,
      draftLabels,
    });

    expect(result.coworkerId).toBe("chat-1");
    expect(result.filterCapability).toBe("chat");
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
        goal: "Create me Data Visualisation for my Excel Sheet.",
        preferredCoworkerSlug: "alex",
      },
      coworkers,
      draftLabels,
    });

    expect(result.coworkerId).toBe("alex-id");
    expect(result.draftText).toBe(
      "Goal: Create me Data Visualisation for my Excel Sheet.",
    );
  });

  it("finds preferred slug in chat-capable pool when missing from intent filter", () => {
    const coworkers = [
      coworker({
        id: "task-only",
        slug: "tasky",
        capabilities: ["tasks"],
        canChat: false,
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
        intent: "tasks",
        goal: "Dashboard",
        preferredCoworkerSlug: "alex",
      },
      coworkers,
      draftLabels,
    });

    expect(result.coworkerId).toBe("alex-id");
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
