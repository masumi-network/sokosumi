import { describe, expect, it } from "vitest";

import {
  CHAT_UI_REASONING_PART_TYPE_VALUES,
  isChatUiProviderReasoningPartType,
} from "./chat-ui-reasoning-part-types";

describe("isChatUiProviderReasoningPartType", () => {
  it("allowlists only AI SDK reasoning", () => {
    expect(isChatUiProviderReasoningPartType("reasoning")).toBe(true);
    expect(CHAT_UI_REASONING_PART_TYPE_VALUES).toEqual(["reasoning"]);
  });

  it("trims type strings before allowlist match", () => {
    expect(isChatUiProviderReasoningPartType("  reasoning  ")).toBe(true);
  });

  it("rejects standard body types", () => {
    expect(isChatUiProviderReasoningPartType("text")).toBe(false);
    expect(isChatUiProviderReasoningPartType("output_text")).toBe(false);
    expect(isChatUiProviderReasoningPartType("input_text")).toBe(false);
    expect(isChatUiProviderReasoningPartType("file")).toBe(false);
  });

  it("rejects tool/step, legacy, and other non-allowlisted part types", () => {
    expect(isChatUiProviderReasoningPartType("tool-call")).toBe(false);
    expect(isChatUiProviderReasoningPartType("tool-result")).toBe(false);
    expect(isChatUiProviderReasoningPartType("tool-invocation")).toBe(false);
    expect(isChatUiProviderReasoningPartType("step-start")).toBe(false);
    expect(isChatUiProviderReasoningPartType("source-url")).toBe(false);
    expect(isChatUiProviderReasoningPartType("data-something")).toBe(false);
    expect(isChatUiProviderReasoningPartType("redacted_reasoning")).toBe(false);
    expect(isChatUiProviderReasoningPartType("unknown_provider_part")).toBe(
      false,
    );
  });

  it("returns false for empty or non-string types", () => {
    expect(isChatUiProviderReasoningPartType("")).toBe(false);
    expect(isChatUiProviderReasoningPartType("   ")).toBe(false);
    expect(isChatUiProviderReasoningPartType(undefined)).toBe(false);
    expect(isChatUiProviderReasoningPartType(1)).toBe(false);
  });
});
