import { describe, expect, it } from "vitest";
import { isFinalReport, isIdleRound, reportText } from "./rounds";

describe("background run rounds", () => {
  it("takes only a DONE reply as the final report", () => {
    expect(isFinalReport("DONE: 412 contacts in the CRM table.")).toBe(true);
    expect(isFinalReport("**DONE:** all three years searched")).toBe(true);
    expect(isFinalReport("## DONE: page built and reviewed")).toBe(true);
    expect(isFinalReport("✅ DONE — all five steps finished")).toBe(true);
    expect(isFinalReport("Donations page is next")).toBe(false);
    expect(
      isFinalReport("This is only a partial start: April 2024 onward is left."),
    ).toBe(false);
  });

  it("drops the marker from what the owner reads", () => {
    expect(reportText("DONE: 412 contacts in the CRM table.")).toBe(
      "412 contacts in the CRM table.",
    );
    expect(reportText("**DONE:** All searched.")).toBe("All searched.");
    expect(reportText("✅ DONE — Page built.")).toBe("Page built.");
  });

  it("counts a round that only re-read things as idle, never one that waited or wrote", () => {
    expect(isIdleRound(["list_tasks", "get_task_status", "read_file"])).toBe(
      true,
    );
    expect(isIdleRound(["get_task_status", "bash"])).toBe(false);
    expect(isIdleRound(["upload_file", "list_files"])).toBe(false);
  });
});
