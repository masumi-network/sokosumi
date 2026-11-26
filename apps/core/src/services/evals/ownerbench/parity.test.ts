import { describe, expect, it } from "vitest";
import { journeyParity, type ParityReport } from "./parity";

const local = { adapter: "in-process", models: "chatgpt-plan" };
const deployed = { adapter: "sandbox", models: "gateway" };

type Repeat = {
  status: string;
  failed?: number[];
  runtime?: typeof local | null;
};

function report(cases: Record<string, Repeat[]>): ParityReport {
  return {
    cases: Object.entries(cases).map(([caseId, repeats]) => ({
      caseId,
      results: repeats.map(({ status, failed = [], runtime }) => ({
        status,
        output: {
          ...(runtime === null ? {} : { runtime: runtime ?? local }),
          steps: [0, 1, 2].map((index) => ({
            index,
            passed: !failed.includes(index + 1),
          })),
        },
      })),
    })),
  };
}

const verdicts = (a: ParityReport, b: ParityReport) =>
  Object.fromEntries(
    journeyParity(a, b).map((row) => [row.caseId, row.verdict]),
  );

describe("journeyParity", () => {
  it("agrees only when two different runtimes fail the same steps", () => {
    expect(
      verdicts(
        report({
          "owner-same": [{ status: "FAILED", failed: [2] }],
          "owner-other-step": [{ status: "FAILED", failed: [2] }],
          "owner-pass-fail": [{ status: "PASSED" }],
        }),
        report({
          "owner-same": [{ status: "FAILED", failed: [2], runtime: deployed }],
          "owner-other-step": [
            { status: "FAILED", failed: [3], runtime: deployed },
          ],
          "owner-pass-fail": [
            { status: "FAILED", failed: [1], runtime: deployed },
          ],
        }),
      ),
    ).toEqual({
      "owner-same": "agree",
      "owner-other-step": "divergent",
      "owner-pass-fail": "divergent",
    });
  });

  it("leaves unverified what cannot show a runtime difference", () => {
    expect(
      verdicts(
        report({
          "owner-same-adapter": [{ status: "PASSED" }],
          "owner-no-runtime": [{ status: "PASSED", runtime: null }],
          "owner-unscored": [{ status: "ERROR" }],
          "owner-one-side": [{ status: "PASSED" }],
        }),
        report({
          "owner-same-adapter": [{ status: "PASSED" }],
          "owner-no-runtime": [{ status: "PASSED", runtime: deployed }],
          "owner-unscored": [{ status: "PASSED", runtime: deployed }],
        }),
      ),
    ).toEqual({
      "owner-same-adapter": "unverified",
      "owner-no-runtime": "unverified",
      "owner-unscored": "unverified",
      "owner-one-side": "unverified",
    });
  });

  it("compares every scored repeat, not the first", () => {
    const rows = journeyParity(
      report({
        "owner-a": [{ status: "PASSED" }, { status: "FAILED", failed: [2] }],
      }),
      report({
        "owner-a": [
          { status: "PASSED", runtime: deployed },
          { status: "PASSED", runtime: deployed },
        ],
      }),
    );
    expect(rows[0]?.verdict).toBe("divergent");
  });

  it("ignores cases that are not owner journeys", () => {
    expect(
      journeyParity(report({ "chat-post": [{ status: "PASSED" }] }), {
        cases: [],
      }),
    ).toEqual([]);
  });
});
