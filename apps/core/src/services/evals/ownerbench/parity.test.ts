import { describe, expect, it } from "vitest";
import { journeyParity, type ParityReport } from "./parity";

const local = { adapter: "in-process", models: "chatgpt-plan" };
const deployed = { adapter: "sandbox", models: "gateway" };

function report(rows: [string, string, number, typeof local][]): ParityReport {
  return {
    cases: rows.map(([caseId, status, stepsPassed, runtime]) => ({
      caseId,
      results: [
        {
          status,
          output: { score: { stepsPassed, stepsTotal: 3 }, runtime },
        },
      ],
    })),
  };
}

describe("journeyParity", () => {
  it("flags a journey that passes on one runtime only, and differing steps", () => {
    const rows = journeyParity(
      report([
        ["owner-a", "PASSED", 3, local],
        ["owner-b", "FAILED", 1, local],
        ["owner-c", "FAILED", 1, local],
        ["owner-d", "FAILED", 2, local],
      ]),
      report([
        ["owner-a", "FAILED", 2, deployed],
        ["owner-b", "FAILED", 1, deployed],
        ["owner-c", "PASSED", 3, deployed],
        ["owner-e", "PASSED", 1, deployed],
      ]),
    );
    expect(
      Object.fromEntries(rows.map((row) => [row.caseId, row.flag])),
    ).toEqual({
      "owner-a": "passes only on in-process/chatgpt-plan",
      "owner-b": "",
      "owner-c": "fails only on in-process/chatgpt-plan",
      "owner-d": "only ran on in-process/chatgpt-plan",
      "owner-e": "only ran on sandbox/gateway",
    });
  });

  it("flags agreeing statuses with different progress", () => {
    const [row] = journeyParity(
      report([["owner-a", "FAILED", 1, local]]),
      report([["owner-a", "FAILED", 2, deployed]]),
    );
    expect(row?.flag).toBe(
      "steps 1 on in-process/chatgpt-plan, 2 on sandbox/gateway",
    );
  });

  it("ignores cases that are not owner journeys or never finished", () => {
    const rows = journeyParity(
      {
        cases: [
          { caseId: "chat-post", results: [{ status: "PASSED" }] },
          { caseId: "owner-x", results: [{ status: "ERROR" }] },
        ],
      },
      { cases: [] },
    );
    expect(rows).toEqual([]);
  });
});
