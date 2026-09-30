import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateMock } = vi.hoisted(() => ({ evaluateMock: vi.fn() }));
vi.mock("ai", () => ({
  experimental_evaluate: evaluateMock,
  gateway: { evaluationModel: vi.fn() },
}));

import { claimsAction } from "./answer-claims";

describe("claimsAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [0.9, true],
    [0.5, true],
    [0.1, false],
  ])(
    "treats a claim probability of %s as a claim: %s",
    async (probability, claim) => {
      evaluateMock.mockResolvedValue({
        answers: { claimsAction: { probability } },
      });
      await expect(claimsAction("I posted it.")).resolves.toBe(claim);
    },
  );

  it("gives Jev the changes the turn's receipts confirm", async () => {
    evaluateMock.mockResolvedValue({
      answers: { claimsAction: { probability: 0.1 } },
    });
    await claimsAction("I updated memory.", ["Updated memory"]);
    expect(evaluateMock.mock.calls[0][0].state).toEqual({
      reply: "I updated memory.",
      confirmedChanges: ["Updated memory"],
    });
  });

  it("reports a failed or malformed check as unchecked", async () => {
    evaluateMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(claimsAction("Here is the draft.")).resolves.toBeNull();
    evaluateMock.mockResolvedValueOnce({ answers: {} });
    await expect(claimsAction("Here is the draft.")).resolves.toBeNull();
  });
});
