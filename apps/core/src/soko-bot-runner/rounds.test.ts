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

  it("reads DONE inside the JSON narrative a turn that could act answers in", () => {
    const narrative = (message: string) =>
      JSON.stringify({
        kind: "REPORT",
        message,
        question: null,
        observationToolCallIds: [],
      });
    const done = narrative("DONE: Hannah says her day's been productive.");
    expect(isFinalReport(done)).toBe(true);
    expect(isFinalReport(`\`\`\`json\n${done}\n\`\`\``)).toBe(true);
    expect(isFinalReport(narrative("Still reading the inbox."))).toBe(false);
    expect(JSON.parse(reportText(done))).toEqual({
      kind: "REPORT",
      message: "Hannah says her day's been productive.",
      question: null,
      observationToolCallIds: [],
    });
    expect(reportText(narrative("Plain report."))).toBe(
      narrative("Plain report."),
    );
  });

  const calls = (...names: string[]) =>
    names.map((toolName) => ({ toolName, input: {} }));
  const bash = (command: string) => ({ toolName: "bash", input: { command } });

  it("counts a round that only re-read things or slept as idle, never one that worked or wrote", () => {
    expect(
      isIdleRound(calls("list_tasks", "get_task_status", "read_file")),
    ).toBe(true);
    expect(isIdleRound([...calls("get_task_status"), bash("sleep 300")])).toBe(
      true,
    );
    expect(isIdleRound([bash("sleep 5m; sleep 5m")])).toBe(true);
    expect(isIdleRound([bash("sleep 60 && curl https://x.dev")])).toBe(false);
    expect(isIdleRound([bash("python3 build.py")])).toBe(false);
    expect(isIdleRound(calls("upload_file", "list_files"))).toBe(false);
  });
});
