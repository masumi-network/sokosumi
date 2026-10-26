import { describe, expect, it } from "vitest";
import { chipTags, signalChips, signalNeedsReader } from "./signal-chips";

describe("signalChips", () => {
  it("draws one needs-you chip for a question or decision asked of the reader", () => {
    const signal = {
      tags: ["question", "needsDecision", "urgent"] as const,
      addressedUserIds: ["alice"],
    };
    expect(signalChips({ ...signal, tags: [...signal.tags] }, "alice")).toEqual(
      ["needsYou", "urgent"],
    );
    // Someone else is asked: the decision shows as itself, the question not.
    expect(signalChips({ ...signal, tags: [...signal.tags] }, "bob")).toEqual([
      "urgent",
      "needsDecision",
    ]);
  });

  it("never draws a chip for FYI or small talk alone", () => {
    expect(
      signalChips({ tags: ["fyi", "chitChat"], addressedUserIds: [] }, "alice"),
    ).toEqual([]);
  });

  it("orders what changes what the reader does first", () => {
    expect(
      signalChips(
        {
          tags: ["workRequest", "commitment", "decisionMade", "escalation"],
          addressedUserIds: [],
        },
        "alice",
      ),
    ).toEqual(["escalation", "decisionMade", "commitment", "workRequest"]);
  });
});

describe("signalNeedsReader", () => {
  it("needs a signed-in reader who is addressed", () => {
    const signal = { tags: ["question" as const], addressedUserIds: ["alice"] };
    expect(signalNeedsReader(signal, "alice")).toBe(true);
    expect(signalNeedsReader(signal, undefined)).toBe(false);
  });
});

describe("chipTags", () => {
  it("removes every tag behind the needs-you chip at once", () => {
    expect(
      chipTags("needsYou", { tags: ["question", "needsDecision", "urgent"] }),
    ).toEqual(["question", "needsDecision"]);
    expect(chipTags("blocker", { tags: ["blocker"] })).toEqual(["blocker"]);
  });
});
