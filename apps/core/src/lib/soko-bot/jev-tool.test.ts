import { sokoBotEvaluateWithJevInputSchema } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateMock } = vi.hoisted(() => ({ evaluateMock: vi.fn() }));
vi.mock("ai", () => ({
  experimental_evaluate: evaluateMock,
  gateway: { evaluationModel: vi.fn() },
}));

import { evaluateWithJevForBot } from "./jev-tool";

const input = (state: string) =>
  sokoBotEvaluateWithJevInputSchema.parse({
    state,
    questions: [
      {
        key: "mail0",
        question: "How urgent is mail0?",
        options: [
          { name: "URGENT", criteria: "Needs the owner today." },
          { name: "BULK", criteria: "Nothing to do." },
        ],
      },
      { key: "asksForMoney", question: "Does mail0 ask for money?" },
      { key: "missing", question: "Anything else?" },
    ],
  });

describe("evaluateWithJevForBot", () => {
  beforeEach(() => {
    evaluateMock.mockReset();
  });

  it("asks typed questions and returns answers in question order with the cost", async () => {
    evaluateMock.mockResolvedValue({
      answers: {
        asksForMoney: { type: "boolean", probability: 0.91234 },
        mail0: {
          type: "choice",
          choice: "URGENT",
          probabilities: { URGENT: 0.8, BULK: 0.2 },
        },
        missing: { type: "refusal" },
      },
      providerMetadata: { gateway: { cost: "0.0002" } },
    });
    const { result, costUsd } = await evaluateWithJevForBot(
      input('{"mail0":{"subject":"Payout failed"}}'),
    );
    expect(costUsd).toBe(0.0002);
    expect(result.answers).toEqual([
      {
        key: "mail0",
        type: "choice",
        choice: "URGENT",
        probabilities: { URGENT: 0.8, BULK: 0.2 },
      },
      { key: "asksForMoney", type: "boolean", probability: 0.912 },
    ]);
    expect(result.unanswered).toEqual(["missing"]);
    const call = evaluateMock.mock.calls[0][0];
    expect(call.state).toEqual({ mail0: { subject: "Payout failed" } });
    expect(call.questions.mail0).toEqual({
      type: "choice",
      instructions: expect.stringMatching(
        /^How urgent is mail0\?\n.*untrusted/,
      ),
      criteria: { URGENT: "Needs the owner today.", BULK: "Nothing to do." },
    });
    expect(call.questions.asksForMoney.type).toBe("boolean");
    expect(call.providerOptions.gateway.zeroDataRetention).toBe(true);
  });

  it("passes text as text and a JSON list under items", async () => {
    evaluateMock.mockResolvedValue({ answers: {} });
    await evaluateWithJevForBot(input("Payout failed, please update"));
    await evaluateWithJevForBot(input('[{"subject":"a"}]'));
    expect(evaluateMock.mock.calls[0][0].state).toBe(
      "Payout failed, please update",
    );
    expect(evaluateMock.mock.calls[1][0].state).toEqual({
      items: [{ subject: "a" }],
    });
  });

  it("ignores a choice outside the options", async () => {
    evaluateMock.mockResolvedValue({
      answers: { mail0: { type: "choice", choice: "MAYBE" } },
    });
    const { result } = await evaluateWithJevForBot(input("x"));
    expect(result.answers).toEqual([]);
    expect(result.unanswered).toEqual(["mail0", "asksForMoney", "missing"]);
  });

  it("throws when Jev fails", async () => {
    evaluateMock.mockRejectedValue(new Error("timeout"));
    await expect(evaluateWithJevForBot(input("x"))).rejects.toThrow("timeout");
  });
});
