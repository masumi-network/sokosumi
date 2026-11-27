import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateMock } = vi.hoisted(() => ({ evaluateMock: vi.fn() }));
vi.mock("ai", () => ({
  experimental_evaluate: evaluateMock,
  gateway: { evaluationModel: vi.fn() },
}));

import { expectCoreLogWhys } from "@/test/core-log";
import { claimsAction, claimsActionBySentence } from "./answer-claims";

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
    expectCoreLogWhys(
      "warn",
      "Could not check a Soko Bot reply for unconfirmed claims",
      [
        "Jev, the judging model, failed or timed out",
        "Jev, the judging model, failed or timed out",
      ],
    );
    evaluateMock
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"));
    await expect(claimsAction("Here is the draft.")).resolves.toBeNull();
    evaluateMock
      .mockResolvedValueOnce({ answers: {} })
      .mockResolvedValueOnce({ answers: {} });
    await expect(claimsAction("Here is the draft.")).resolves.toBeNull();
  });

  it("asks once more when the first check fails", async () => {
    expectCoreLogWhys(
      "warn",
      "Could not check a Soko Bot reply for unconfirmed claims",
      ["Jev, the judging model, failed or timed out"],
    );
    evaluateMock
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({
        answers: { claimsAction: { probability: 0.1 } },
      });
    await expect(claimsAction("Here is the draft.")).resolves.toBe(false);
    expect(evaluateMock).toHaveBeenCalledTimes(2);
  });
});

describe("claimsActionBySentence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scores each sentence in one batched Jev call against confirmedChanges", async () => {
    evaluateMock.mockResolvedValue({
      answers: {
        s0: { probability: 0.1 },
        s1: { probability: 0.85 },
        s2: { probability: 0.05 },
      },
    });
    const sentences = [
      "I drafted three X posts from the one-pager.",
      "I spread them across Monday, Wednesday, and Friday.",
      "They are waiting for your approval.",
    ];
    await expect(
      claimsActionBySentence(sentences, [
        "Created social post (draft awaiting approval; not scheduled)",
      ]),
    ).resolves.toEqual([false, true, false]);
    expect(evaluateMock).toHaveBeenCalledTimes(1);
    expect(evaluateMock.mock.calls[0][0].state).toEqual({
      sentences: {
        s0: sentences[0],
        s1: sentences[1],
        s2: sentences[2],
      },
      confirmedChanges: [
        "Created social post (draft awaiting approval; not scheduled)",
      ],
    });
  });

  it("retries only missing sentence keys once and returns null for still-missing keys", async () => {
    evaluateMock
      .mockResolvedValueOnce({
        answers: {
          s0: { probability: 0.1 },
        },
      })
      .mockResolvedValueOnce({
        answers: {
          s0: { probability: 0.9 },
        },
      });
    await expect(
      claimsActionBySentence(["Safe line.", "I scheduled it."], []),
    ).resolves.toEqual([false, true]);
    expect(evaluateMock).toHaveBeenCalledTimes(2);
  });
});
