import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  EVALS_REPORT_EMAILS: "patrick@example.com, ops@example.com" as
    | string
    | undefined,
}));
const sendEmail = vi.hoisted(() =>
  vi.fn(async (_input: unknown) => ({ id: "email-1" })),
);
const report = vi.hoisted(() => ({
  run: { prNumber: 6940, commitSha: "abcdef1" },
  cases: [] as unknown[],
}));

vi.mock("@/config/env", () => ({
  getEnv: () => env,
  getWebAppBaseUrl: () => "https://app.sokosumi.com",
}));
vi.mock("@/clients/email.client", () => ({ sendEmail }));
vi.mock("./eval-runs.service", () => ({
  getEvalRunReport: vi.fn(async () => report),
}));

import { sendEvalRegressionEmail } from "./eval-report-email";

const regressed = {
  caseId: "ambiguous-request",
  title: "Ambiguous request",
  outcome: "regressed",
  passRate: 0,
  baselinePassRate: 1,
  results: [
    {
      checks: [
        { label: "Asks a question", pass: false, actual: "no <question>" },
      ],
      error: null,
    },
  ],
};

describe("sendEvalRegressionEmail", () => {
  beforeEach(() => {
    sendEmail.mockClear();
    env.EVALS_REPORT_EMAILS = "patrick@example.com, ops@example.com";
    report.cases = [
      regressed,
      { ...regressed, caseId: "x", outcome: "passing" },
    ];
  });

  it("names each regressed case, the PR and the run", async () => {
    expect(await sendEvalRegressionEmail("run-1")).toBe(true);
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ["patrick@example.com", "ops@example.com"],
        subject: "Evals: 1 case regressed after #6940",
        tag: "eval-regression",
        idempotencyKey: "eval-regression:run-1",
      }),
    );
    const sent = sendEmail.mock.calls[0]?.[0] as unknown as {
      text: string;
      html: string;
    };
    expect(sent.text).toContain(
      "Ambiguous request (ambiguous-request): 0%, was 100%. Asks a question: no <question>",
    );
    expect(sent.text).toContain(
      "https://app.sokosumi.com/admin/evals/runs/run-1",
    );
    expect(sent.html).toContain("no &lt;question&gt;");
  });

  it("sends nothing without a regression", async () => {
    report.cases = [{ ...regressed, outcome: "flaky" }];
    expect(await sendEvalRegressionEmail("run-1")).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("sends nothing when nobody is set to hear it", async () => {
    env.EVALS_REPORT_EMAILS = undefined;
    expect(await sendEvalRegressionEmail("run-1")).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
