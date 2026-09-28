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

  it("counts a failed or malformed check as a claim", async () => {
    evaluateMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(claimsAction("Here is the draft.")).resolves.toBe(true);
    evaluateMock.mockResolvedValueOnce({ answers: {} });
    await expect(claimsAction("Here is the draft.")).resolves.toBe(true);
  });
});
