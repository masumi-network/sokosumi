import { describe, expect, it } from "vitest";
import {
  CHAT_SIGNAL_THRESHOLD,
  chatSignalNeedsReader,
  effectiveChatSignalTags,
  isTooShortForChatSignals,
  resolveChatSignalDueAt,
} from "./tags";

describe("effectiveChatSignalTags", () => {
  it("keeps the tags at or above the threshold", () => {
    const tags = effectiveChatSignalTags({
      question: 0.99,
      fyi: CHAT_SIGNAL_THRESHOLD,
      blocker: 0.59,
    });
    expect([...tags].sort()).toEqual(["fyi", "question"]);
  });

  it("lets a reader's correction add or remove a tag, newest last", () => {
    const tags = effectiveChatSignalTags({ question: 0.99, fyi: 0.1 }, [
      { tag: "question", applies: false },
      { tag: "fyi", applies: true },
      { tag: "fyi", applies: false },
      { tag: "commitment", applies: true },
    ]);
    expect([...tags].sort()).toEqual(["commitment"]);
  });

  it("ignores corrections of tags outside the vocabulary", () => {
    expect([
      ...effectiveChatSignalTags({}, [{ tag: "spam", applies: true }]),
    ]).toEqual([]);
  });
});

describe("chatSignalNeedsReader", () => {
  it("needs a reader only when it asks them a question or a decision", () => {
    expect(
      chatSignalNeedsReader(new Set(["question"]), ["alice"], "alice"),
    ).toBe(true);
    expect(
      chatSignalNeedsReader(new Set(["needsDecision"]), ["alice"], "alice"),
    ).toBe(true);
    expect(chatSignalNeedsReader(new Set(["question"]), ["bob"], "alice")).toBe(
      false,
    );
    expect(chatSignalNeedsReader(new Set(["fyi"]), ["alice"], "alice")).toBe(
      false,
    );
  });
});

describe("isTooShortForChatSignals", () => {
  it.each([
    "ok",
    "OK!",
    "thanks 🙏",
    "👍",
    "lol",
    "sounds good",
    "https://example.test/a",
    "@0190a0a0-0000-7000-8000-000000000001:alice yes",
  ])("skips %s", (content) => {
    expect(isTooShortForChatSignals(content)).toBe(true);
  });

  it.each([
    "Can you send the pricing sheet?",
    "Decided: we launch Monday",
    "I'll review it tomorrow",
  ])("reads %s", (content) => {
    expect(isTooShortForChatSignals(content)).toBe(false);
  });
});

describe("resolveChatSignalDueAt", () => {
  // Wednesday 2026-10-21, mid-afternoon UTC.
  const wednesday = new Date("2026-10-21T15:00:00Z");

  it.each([
    ["NONE", null],
    ["TODAY", "2026-10-21T23:59:59.000Z"],
    ["TOMORROW", "2026-10-22T23:59:59.000Z"],
    ["FRIDAY", "2026-10-23T23:59:59.000Z"],
    ["WEDNESDAY", "2026-10-21T23:59:59.000Z"],
    ["MONDAY", "2026-10-26T23:59:59.000Z"],
    ["THIS_WEEK", "2026-10-23T23:59:59.000Z"],
    ["NEXT_WEEK", "2026-10-30T23:59:59.000Z"],
    ["THIS_MONTH", "2026-10-31T23:59:59.000Z"],
  ] as const)("resolves %s from a Wednesday", (choice, expected) => {
    expect(
      resolveChatSignalDueAt(choice, wednesday)?.toISOString() ?? null,
    ).toBe(expected);
  });

  it("reads this week said on a weekend as today", () => {
    const saturday = new Date("2026-10-24T10:00:00Z");
    expect(resolveChatSignalDueAt("THIS_WEEK", saturday)?.toISOString()).toBe(
      "2026-10-24T23:59:59.000Z",
    );
  });
});
