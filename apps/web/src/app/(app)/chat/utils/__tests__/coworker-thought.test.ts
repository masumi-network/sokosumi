import { describe, expect, it } from "vitest";

import {
  extractThoughtDurationSeconds,
  extractThoughtTextFromMessageParts,
  extractThoughtTextFromMetadata,
  formatThoughtDurationLabel,
  resolveCoworkerThoughtViewModel,
} from "../coworker-thought";

describe("formatThoughtDurationLabel", () => {
  it("formats under a minute as seconds", () => {
    expect(formatThoughtDurationLabel(3)).toBe("3s");
    expect(formatThoughtDurationLabel(59)).toBe("59s");
  });

  it("formats a minute and above as m and optional s", () => {
    expect(formatThoughtDurationLabel(60)).toBe("1m");
    expect(formatThoughtDurationLabel(63)).toBe("1m 3s");
    expect(formatThoughtDurationLabel(125)).toBe("2m 5s");
  });
});

describe("extractThoughtTextFromMessageParts", () => {
  it("joins non-empty reasoning parts in order", () => {
    expect(
      extractThoughtTextFromMessageParts([
        { type: "reasoning", text: "First beat." },
        { type: "text", text: "Answer" },
        { type: "reasoning", text: "Second beat." },
      ]),
    ).toBe("First beat.\n\nSecond beat.");
  });

  it("treats redacted_reasoning as Thought", () => {
    expect(
      extractThoughtTextFromMessageParts([
        { type: "redacted_reasoning", text: "[hidden summary]" },
      ]),
    ).toBe("[hidden summary]");
  });

  it("ignores empty reasoning and non-reasoning types", () => {
    expect(
      extractThoughtTextFromMessageParts([
        { type: "reasoning", text: "  " },
        { type: "text", text: "Hello" },
        { type: "file", url: "https://x", mediaType: "image/png" },
      ]),
    ).toBe("");
  });

  it("does not treat tool/step parts with text as Thought", () => {
    expect(
      extractThoughtTextFromMessageParts([
        { type: "tool-call", text: "Calling search…" },
        { type: "tool-result", content: "42 results" },
        { type: "step-start", text: "Step 1" },
        { type: "reasoning", text: "Only this is Thought." },
      ]),
    ).toBe("Only this is Thought.");
  });
});

describe("extractThoughtTextFromMetadata", () => {
  it("reads metadata.reasoning steps", () => {
    expect(
      extractThoughtTextFromMetadata({
        reasoning: [
          { type: "reasoning", text: "Looked up users." },
          { type: "reasoning", text: "Counted 142." },
        ],
      }),
    ).toBe("Looked up users.\n\nCounted 142.");
  });

  it("returns empty when reasoning missing or empty", () => {
    expect(extractThoughtTextFromMetadata(null)).toBe("");
    expect(extractThoughtTextFromMetadata({})).toBe("");
    expect(extractThoughtTextFromMetadata({ reasoning: [] })).toBe("");
  });

  it("rejects tool/step steps stored under metadata.reasoning", () => {
    expect(
      extractThoughtTextFromMetadata({
        reasoning: [
          { type: "tool-call", text: "should not show" },
          { type: "reasoning", text: "real Thought" },
        ],
      }),
    ).toBe("real Thought");
  });
});

describe("extractThoughtDurationSeconds", () => {
  it("returns whole seconds from thought_timing_ms when valid", () => {
    expect(
      extractThoughtDurationSeconds({
        thought_timing_ms: { start: 1000, end: 4500 },
      }),
    ).toBe(4);
  });

  it("accepts numeric strings for start/end", () => {
    expect(
      extractThoughtDurationSeconds({
        thought_timing_ms: { start: "1000", end: "64000" },
      }),
    ).toBe(63);
  });

  it("returns null when timing missing or invalid", () => {
    expect(extractThoughtDurationSeconds(null)).toBeNull();
    expect(
      extractThoughtDurationSeconds({
        thought_timing_ms: { start: 0, end: 10 },
      }),
    ).toBeNull();
    expect(
      extractThoughtDurationSeconds({
        thought_timing_ms: { start: 5000, end: 1000 },
      }),
    ).toBeNull();
  });
});

describe("resolveCoworkerThoughtViewModel", () => {
  it("shows live beat while stream overlay has Thought but no answer", () => {
    const vm = resolveCoworkerThoughtViewModel({
      content: "",
      isStreamOverlay: true,
      metadata: {
        streaming: true,
        reasoning: [{ type: "reasoning", text: "Counting registrations…" }],
      },
    });
    expect(vm).toEqual({
      liveBeat: "Counting registrations…",
      disclosure: null,
      showThinkingFallback: false,
    });
  });

  it("uses only the latest Thought step for the live beat", () => {
    const vm = resolveCoworkerThoughtViewModel({
      content: "",
      isStreamOverlay: true,
      metadata: {
        streaming: true,
        reasoning: [
          { type: "reasoning", text: "First beat." },
          { type: "reasoning", text: "Latest beat." },
        ],
      },
    });
    expect(vm.liveBeat).toBe("Latest beat.");
    expect(vm.disclosure).toBeNull();
  });

  it("joins all Thought steps in disclosure text", () => {
    const vm = resolveCoworkerThoughtViewModel({
      content: "Answer",
      isStreamOverlay: false,
      metadata: {
        reasoning: [
          { type: "reasoning", text: "First." },
          { type: "reasoning", text: "Second." },
        ],
      },
    });
    expect(vm.disclosure?.text).toBe("First.\n\nSecond.");
  });

  it("falls back to Thinking when stream overlay empty of answer and Thought", () => {
    const vm = resolveCoworkerThoughtViewModel({
      content: "   ",
      isStreamOverlay: true,
      metadata: { streaming: true },
    });
    expect(vm).toEqual({
      liveBeat: null,
      disclosure: null,
      showThinkingFallback: true,
    });
  });

  it("uses parts when metadata has no reasoning yet", () => {
    const vm = resolveCoworkerThoughtViewModel({
      content: "",
      isStreamOverlay: true,
      metadata: { streaming: true },
      parts: [{ type: "reasoning", text: "From parts" }],
    });
    expect(vm.liveBeat).toBe("From parts");
    expect(vm.showThinkingFallback).toBe(false);
  });

  it("shows collapsed disclosure when answer and Thought present", () => {
    const vm = resolveCoworkerThoughtViewModel({
      content: "There were 142 registrations.",
      isStreamOverlay: false,
      metadata: {
        reasoning: [{ type: "reasoning", text: "Queried users table." }],
        thought_timing_ms: { start: 0, end: 12_000 },
      },
    });
    // start 0 is invalid for duration
    expect(vm.liveBeat).toBeNull();
    expect(vm.showThinkingFallback).toBe(false);
    expect(vm.disclosure).toEqual({
      text: "Queried users table.",
      durationSeconds: null,
    });
  });

  it("includes durationSeconds when timing valid", () => {
    const vm = resolveCoworkerThoughtViewModel({
      content: "Done.",
      isStreamOverlay: false,
      metadata: {
        reasoning: [{ type: "reasoning", text: "Step one." }],
        thought_timing_ms: { start: 1000, end: 19_500 },
      },
    });
    expect(vm.disclosure).toEqual({
      text: "Step one.",
      durationSeconds: 19,
    });
  });

  it("has no disclosure when Thought empty even with answer", () => {
    const vm = resolveCoworkerThoughtViewModel({
      content: "Hello",
      isStreamOverlay: false,
      metadata: null,
    });
    expect(vm.disclosure).toBeNull();
    expect(vm.showThinkingFallback).toBe(false);
  });

  it("prefers disclosure over live beat once answer text exists on stream overlay", () => {
    const vm = resolveCoworkerThoughtViewModel({
      content: "Partial answer",
      isStreamOverlay: true,
      metadata: {
        streaming: true,
        reasoning: [{ type: "reasoning", text: "Still thinking notes" }],
      },
    });
    expect(vm.liveBeat).toBeNull();
    expect(vm.disclosure?.text).toBe("Still thinking notes");
    expect(vm.showThinkingFallback).toBe(false);
  });
});
