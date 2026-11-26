import { describe, expect, it } from "vitest";
import { withoutActionReceipts } from "../action-labels.js";

describe("withoutActionReceipts", () => {
  it("drops Core's receipt paragraph above the bot's words", () => {
    expect(
      withoutActionReceipts(
        "Configured schedule.\n\nDone — I'll remind you every Monday at 9:00.",
      ),
    ).toBe("Done — I'll remind you every Monday at 9:00.");
  });

  it("drops several receipt lines, counted, named and earlier ones", () => {
    expect(
      withoutActionReceipts(
        [
          "Created 3 Tasks: [A](/tasks/1), [B](/tasks/2), [C](/tasks/3).",
          "Updated social post (28×).",
          "Previously verified: Assigned task [D](/tasks/4).",
          "",
          "All set.",
        ].join("\n"),
      ),
    ).toBe("All set.");
  });

  it("keeps a reply that is only receipts", () => {
    expect(withoutActionReceipts("Configured schedule.")).toBe(
      "Configured schedule.",
    );
  });

  it("keeps a first paragraph that is the bot's own words", () => {
    const text = "Created a plan for you.\n\nHere it is.";
    expect(withoutActionReceipts(text)).toBe(text);
  });

  it("keeps a refusal, which the reader needs to see", () => {
    const text = "Not confirmed: archived task.\n\nI could not archive it.";
    expect(withoutActionReceipts(text)).toBe(text);
  });
});
