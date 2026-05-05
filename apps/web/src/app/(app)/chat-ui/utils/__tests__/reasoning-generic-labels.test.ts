import { describe, expect, it } from "vitest";

import { getReasoningStepDisplayText } from "../reasoning-generic-labels";

describe("getReasoningStepDisplayText", () => {
  it("returns null for placeholder-only strings", () => {
    expect(getReasoningStepDisplayText("Thinking...")).toBeNull();
    expect(getReasoningStepDisplayText("Processing...")).toBeNull();
  });

  it("does not strip placeholder-looking text from real summaries", () => {
    expect(getReasoningStepDisplayText("Thinking...Real summary")).toBe(
      "Thinking...Real summary",
    );
    expect(getReasoningStepDisplayText("Processing...Thinking...Final")).toBe(
      "Processing...Thinking...Final",
    );
  });

  it("trims whitespace without removing provider text", () => {
    expect(getReasoningStepDisplayText("  _thought\nBody  ")).toBe(
      "_thought\nBody",
    );
  });
});
