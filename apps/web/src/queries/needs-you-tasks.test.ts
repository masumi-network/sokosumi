import { describe, expect, it } from "vitest";
import { waitingQuestion } from "./needs-you-tasks";

function event(
  id: string,
  comment: string | null,
  extra: Record<string, unknown> = {},
) {
  return { id, comment, status: null, userId: null, ...extra };
}

describe("waitingQuestion", () => {
  it("is the comment that asked for input, not later chatter", () => {
    expect(
      waitingQuestion([
        event("e1", "Write a launch post"),
        event("e2", "Which audience?", { status: "INPUT_REQUIRED" }),
        event("e3", "Following along", { userId: "u2" }),
      ] as never),
    ).toBe("Which audience?");
  });

  it("falls back to the agent's newest comment", () => {
    expect(
      waitingQuestion([
        event("e1", "Brief", { userId: "u1" }),
        event("e2", "Old question"),
        event("e3", "Newest question"),
        event("e4", "My note", { userId: "u1" }),
      ] as never),
    ).toBe("Newest question");
  });

  it("is null when the agent said nothing", () => {
    expect(
      waitingQuestion([event("e1", "Brief", { userId: "u1" })] as never),
    ).toBeNull();
  });

  it("reads only the current wait, never an earlier ask", () => {
    expect(
      waitingQuestion([
        event("e1", "Which audience?", { status: "INPUT_REQUIRED" }),
        event("e2", "Bakeries", { userId: "u1" }),
        event("e3", null, { status: "RUNNING" }),
        event("e4", null, { status: "INPUT_REQUIRED" }),
      ] as never),
    ).toBeNull();
  });

  it("finds the question asked just before the current wait began", () => {
    expect(
      waitingQuestion([
        event("e1", "Old question", { status: "INPUT_REQUIRED" }),
        event("e2", null, { status: "RUNNING" }),
        event("e3", "Which city?"),
        event("e4", null, { status: "INPUT_REQUIRED" }),
      ] as never),
    ).toBe("Which city?");
  });
});
