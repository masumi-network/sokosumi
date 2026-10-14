import { describe, expect, it } from "vitest";
import { isFinalReport, reportText } from "./rounds";

describe("background run rounds", () => {
  it("takes only a DONE reply as the final report", () => {
    expect(isFinalReport("DONE: 412 contacts in the CRM table.")).toBe(true);
    expect(isFinalReport("**DONE:** all three years searched")).toBe(true);
    expect(
      isFinalReport("This is only a partial start: April 2024 onward is left."),
    ).toBe(false);
  });

  it("drops the marker from what the owner reads", () => {
    expect(reportText("DONE: 412 contacts in the CRM table.")).toBe(
      "412 contacts in the CRM table.",
    );
    expect(reportText("**DONE:** All searched.")).toBe("All searched.");
  });
});
