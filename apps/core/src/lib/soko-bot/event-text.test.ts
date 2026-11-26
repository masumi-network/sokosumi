import { describe, expect, it } from "vitest";
import { safeReasoningSummary, withoutAnswerContract } from "./event-text";

describe("withoutAnswerContract", () => {
  it("drops what the model says about Core's answer format", () => {
    // From a prod reasoning summary, 2026-11-25.
    const text = [
      "**Clarifying report update details**",
      "I need to create a report update card based on a background task request. The final response should be a JSON object, and I shouldn't mention the actions taken. I can say something like a summary of the month.",
      "**Picking observations**",
      "I should copy the evidenceToolCallId into observationToolCallIds. Core lists every verified action from its receipts.",
    ].join("\n\n");
    expect(withoutAnswerContract(text)).toBe(
      [
        "**Clarifying report update details**",
        "I need to create a report update card based on a background task request. I can say something like a summary of the month.",
      ].join("\n\n"),
    );
  });

  it("drops a sentence about the reply's schema", () => {
    expect(
      withoutAnswerContract(
        "My reply should use the required response schema. The Padierfind account is connected.",
      ),
    ).toBe("The Padierfind account is connected.");
  });

  it("keeps receipts and JSON that belong to the owner's work", () => {
    for (const text of [
      "Two receipts are missing from the expense report.",
      "The CRM export is a JSON file with 40 rows.",
    ])
      expect(withoutAnswerContract(text)).toBe(text);
  });

  it("keeps reasoning about the owner's work", () => {
    const text =
      "**Checking the X account**\n\nThe Padierfind project has one X account. I'll draft the post there and keep it for approval.";
    expect(withoutAnswerContract(text)).toBe(text);
  });
});

describe("safeReasoningSummary", () => {
  it("is null when only the answer format was left", () => {
    expect(
      safeReasoningSummary({
        text: "**Finalizing**\n\nThe reply must be one JSON object with kind REPORT.",
      }),
    ).toBeNull();
  });
});
