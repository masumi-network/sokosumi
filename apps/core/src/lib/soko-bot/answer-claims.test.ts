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
      readObservations: [],
    });
  });

  it("keeps read evidence separate from the assistant's confirmed changes", async () => {
    evaluateMock.mockResolvedValue({
      answers: { claimsAction: { probability: 0.1 } },
    });
    const result = {
      messages: [{ author: "Hannah", text: "I finished the research." }],
    };
    await claimsAction(
      "Hannah finished the research.",
      [],
      [{ capability: "read_chat", result }],
    );
    expect(evaluateMock.mock.calls[0][0].state).toEqual({
      reply: "Hannah finished the research.",
      confirmedChanges: [],
      readObservations: [
        { capability: "read_chat", result: JSON.stringify(result) },
      ],
    });
  });

  it("bounds read evidence without dropping the claim check", async () => {
    evaluateMock.mockResolvedValue({
      answers: { claimsAction: { probability: 0.9 } },
    });
    await expect(
      claimsAction(
        "I posted it.",
        [],
        Array.from({ length: 10 }, () => ({
          capability: "read_chat",
          result: { text: "x".repeat(10_000) },
        })),
      ),
    ).resolves.toBe(true);
    const observations = evaluateMock.mock.calls[0][0].state.readObservations;
    expect(observations).toHaveLength(4);
    expect(
      observations.every(
        (item: { result: string }) => item.result.length <= 6_000,
      ),
    ).toBe(true);
  });

  it("reports a failed or malformed check as unchecked", async () => {
    evaluateMock.mockRejectedValueOnce(new Error("timeout"));
    await expect(claimsAction("Here is the draft.")).resolves.toBeNull();
    evaluateMock.mockResolvedValueOnce({ answers: {} });
    await expect(claimsAction("Here is the draft.")).resolves.toBeNull();
  });
});
