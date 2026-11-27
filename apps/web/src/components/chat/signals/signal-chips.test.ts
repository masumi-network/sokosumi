import type { ChatSignalTag } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";
import {
  CHAT_SIGNAL_TAG_ORDER,
  chipTags,
  signalChips,
  signalNeedsReader,
  tagEditorRows,
} from "./signal-chips";

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

describe("tagEditorRows", () => {
  const signal = {
    tags: ["announcement", "decisionMade", "review"] as ChatSignalTag[],
    probabilities: { decisionMade: 0.97, announcement: 0.7, question: 0.02 },
    correctedTags: ["review"] as ChatSignalTag[],
  };

  it("lists applied tags first, in editor order, with a plain confidence word", () => {
    expect(tagEditorRows(signal, signal.tags).applied).toEqual([
      { tag: "decisionMade", confidence: "veryLikely" },
      { tag: "announcement", confidence: "likely" },
      { tag: "review", confidence: "byHand" },
    ]);
  });

  it("puts every other tag under more tags, without a score", () => {
    const { more } = tagEditorRows(signal, signal.tags);
    expect(more).toEqual(
      CHAT_SIGNAL_TAG_ORDER.filter(
        (tag) => !["decisionMade", "announcement", "review"].includes(tag),
      ),
    );
  });

  it("gives no word to an applied tag without a score or below the tag line", () => {
    const rows = tagEditorRows(
      { tags: ["bug", "fyi"], probabilities: { fyi: 0.4 }, correctedTags: [] },
      ["bug", "fyi"],
    );
    expect(rows.applied).toEqual([
      { tag: "bug", confidence: null },
      { tag: "fyi", confidence: null },
    ]);
  });

  it("keeps rows where they were while the editor is open, and drops the word of an unticked tag", () => {
    const opened = ["decisionMade"] as ChatSignalTag[];
    const now = {
      tags: ["question"] as ChatSignalTag[],
      probabilities: { decisionMade: 0.97 },
      correctedTags: ["decisionMade", "question"] as ChatSignalTag[],
    };
    const rows = tagEditorRows(now, opened);
    expect(rows.applied).toEqual([{ tag: "decisionMade", confidence: null }]);
    expect(rows.more).toContain("question");
  });
});
