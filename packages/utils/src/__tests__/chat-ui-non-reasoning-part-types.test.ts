import { describe, expect, it } from "vitest";

import { isChatUiProviderReasoningPartType } from "../chat-ui-non-reasoning-part-types";

describe("isChatUiProviderReasoningPartType", () => {
  it("treats standard body types as non-reasoning", () => {
    expect(isChatUiProviderReasoningPartType("text")).toBe(false);
    expect(isChatUiProviderReasoningPartType("output_text")).toBe(false);
    expect(isChatUiProviderReasoningPartType("input_text")).toBe(false);
    expect(isChatUiProviderReasoningPartType("file")).toBe(false);
  });

  it("treats reasoning and provider-specific labels as reasoning", () => {
    expect(isChatUiProviderReasoningPartType("reasoning")).toBe(true);
    expect(isChatUiProviderReasoningPartType("redacted_reasoning")).toBe(true);
  });

  it("returns false for empty or non-string types", () => {
    expect(isChatUiProviderReasoningPartType("")).toBe(false);
    expect(isChatUiProviderReasoningPartType("   ")).toBe(false);
    expect(isChatUiProviderReasoningPartType(undefined)).toBe(false);
    expect(isChatUiProviderReasoningPartType(1)).toBe(false);
  });
});
