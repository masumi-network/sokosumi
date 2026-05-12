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

  it("extracts thought from ReAct JSON reasoning objects", () => {
    const raw = JSON.stringify({
      action: "dalle.text2im",
      action_input: JSON.stringify({ prompt: "Cyberpunk city" }),
      thought:
        "I will generate a high-detail cyberpunk city landscape with neon lights.",
    });

    expect(getReasoningStepDisplayText(raw)).toBe(
      "I will generate a high-detail cyberpunk city landscape with neon lights.",
    );
  });

  it("extracts thought from numeric-prefixed JSON reasoning objects", () => {
    const raw = `0${JSON.stringify({
      action: "dalle.text2im",
      action_input: JSON.stringify({ prompt: "Cyberpunk city" }),
      thought: "I will generate the requested image.",
    })}`;

    expect(getReasoningStepDisplayText(raw)).toBe(
      "I will generate the requested image.",
    );
  });
});
