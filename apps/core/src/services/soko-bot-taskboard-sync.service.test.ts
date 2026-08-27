import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  SokoBotBusyError: class extends Error {},
  sokoBotControlPlane: {},
}));

import {
  buildTaskboardMessage,
  isRelevantBoardComment,
} from "../soko-bot-taskboard-sync.service";

describe("buildTaskboardMessage", () => {
  it("separates work handed to the bot from updates it only follows", () => {
    const message = buildTaskboardMessage([
      {
        taskId: "t1",
        name: "Write launch brief",
        status: "READY",
        assignedToBot: true,
        work: true,
        events: [
          {
            at: new Date(),
            by: "Patrick",
            status: "READY",
            comment: "Keep it to one page.",
          },
        ],
      },
      {
        taskId: "t2",
        name: "Pricing research",
        status: "RUNNING",
        assignedToBot: false,
        work: false,
        events: [
          {
            at: new Date(),
            by: "Coworker Ada",
            status: null,
            comment: "Which currency should I use?",
          },
        ],
      },
    ]);
    expect(message).toContain("## Tasks assigned to you");
    expect(message).toContain(
      '"Write launch brief" (id t1) is READY and waiting for you.',
    );
    expect(message).toContain("Patrick set READY: Keep it to one page.");
    expect(message).toContain("## New on Tasks you follow");
    expect(message).toContain("Coworker Ada: Which currency should I use?");
    expect(message).toContain("Nothing to add.");
  });
});

describe("isRelevantBoardComment", () => {
  const memoryTokens = new Set(["marketplace", "launch"]);
  it("lets through mentions, questions, and memory overlap only", () => {
    expect(
      isRelevantBoardComment({
        comment: "Atlas, can you check?",
        botName: "Atlas",
        memoryTokens,
      }),
    ).toBe(true);
    expect(
      isRelevantBoardComment({
        comment: "Which currency should we use?",
        botName: "Atlas",
        memoryTokens,
      }),
    ).toBe(true);
    expect(
      isRelevantBoardComment({
        comment: "Draft done for the marketplace page.",
        botName: "Atlas",
        memoryTokens,
      }),
    ).toBe(true);
    expect(
      isRelevantBoardComment({
        comment: "Looks good, shipping it.",
        botName: "Atlas",
        memoryTokens,
      }),
    ).toBe(false);
  });
});
