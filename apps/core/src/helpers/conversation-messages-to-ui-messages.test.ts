import { describe, expect, it } from "vitest";

import { assistantContentPartsToAiSdkUiParts } from "./conversation-messages-to-ui-messages";

describe("assistantContentPartsToAiSdkUiParts", () => {
  it("maps only allowlisted reasoning to ReasoningUIPart", () => {
    expect(
      assistantContentPartsToAiSdkUiParts([
        { type: "reasoning", text: "Thought beat" },
        { type: "output_text", text: "Answer" },
      ]),
    ).toEqual([
      { type: "reasoning", text: "Thought beat" },
      { type: "text", text: "Answer" },
    ]);
  });

  it("maps exotic primary body types and legacy labels to text, not Thought", () => {
    expect(
      assistantContentPartsToAiSdkUiParts([
        { type: "redacted_reasoning", text: "legacy" },
        { type: "custom_primary", text: "Body from contentType" },
        { type: "reasoning", text: "Real Thought" },
      ]),
    ).toEqual([
      { type: "text", text: "legacy" },
      { type: "text", text: "Body from contentType" },
      { type: "reasoning", text: "Real Thought" },
    ]);
  });
});
