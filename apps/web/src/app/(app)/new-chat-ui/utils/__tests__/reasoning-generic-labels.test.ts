import { describe, expect, it } from "vitest";

import { getReasoningStepDisplayText } from "../reasoning-generic-labels";

describe("getReasoningStepDisplayText", () => {
  it("returns null for placeholder-only strings", () => {
    expect(getReasoningStepDisplayText("Thinking...")).toBeNull();
    expect(getReasoningStepDisplayText("Processing...")).toBeNull();
  });

  it("strips one or more leading placeholders", () => {
    expect(getReasoningStepDisplayText("Thinking...Real summary")).toBe(
      "Real summary",
    );
    expect(getReasoningStepDisplayText("Processing...Thinking...Final")).toBe(
      "Final",
    );
  });

  it("trims whitespace after stripping", () => {
    expect(getReasoningStepDisplayText("Thinking...  \n  Body")).toBe("Body");
  });
});
