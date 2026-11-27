import { beforeEach, describe, expect, it, vi } from "vitest";
import { COMPLETION_DECIDER_EVENT } from "./completion-decider";

const mocks = vi.hoisted(() => ({
  findTurn: vi.fn(),
  findToolCalls: vi.fn(),
  findFirstToolCall: vi.fn(),
  countPendingDecisions: vi.fn(),
  findFirstPendingDecision: vi.fn(),
  findFirstRuntimeEvent: vi.fn(),
  findDelegation: vi.fn(),
  findManyDelegations: vi.fn(),
  findWatch: vi.fn(),
  findManyWatches: vi.fn(),
  findChildTurn: vi.fn(),
  findManyChildTurns: vi.fn(),
  resolveVersion: vi.fn(),
  resolveRequestId: vi.fn(),
  readRequestPlan: vi.fn(),
  evaluateWithJev: vi.fn(),
  append: vi.fn(),
  appendUnless: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: {
      findUnique: mocks.findTurn,
      findFirst: mocks.findChildTurn,
      findMany: mocks.findManyChildTurns,
    },
    sokoBotToolCall: {
      findMany: mocks.findToolCalls,
      findFirst: mocks.findFirstToolCall,
    },
    sokoBotPendingDecision: {
      count: mocks.countPendingDecisions,
      findFirst: mocks.findFirstPendingDecision,
    },
    sokoBotRuntimeEvent: {
      findFirst: mocks.findFirstRuntimeEvent,
    },
    sokoBotDelegation: {
      findFirst: mocks.findDelegation,
      findMany: mocks.findManyDelegations,
    },
    sokoBotWatch: {
      findFirst: mocks.findWatch,
      findMany: mocks.findManyWatches,
    },
    projectImageJob: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("@/services/soko-bot-version.service", () => ({
  resolveSokoBotVersion: mocks.resolveVersion,
}));

vi.mock("@/lib/soko-bot/request-chain", () => ({
  resolveRequestId: mocks.resolveRequestId,
  readRequestPlan: mocks.readRequestPlan,
}));

vi.mock("@/lib/soko-bot/jev", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/soko-bot/jev")>()),
  evaluateWithJev: mocks.evaluateWithJev,
}));

vi.mock("@/lib/soko-bot/turn-loop", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/soko-bot/turn-loop")>();
  return {
    ...actual,
    RuntimeEventLog: class {
      append = mocks.append;
      appendUnless = mocks.appendUnless;
    },
  };
});

const { evaluateTurnDoneCheck } = await import("./done-check");

function baseTurn(overrides: Record<string, unknown> = {}) {
  return {
    id: "turn-1",
    sokoBotId: "bot-1",
    versionId: "v40",
    source: "CHAT",
    chainDepth: 0,
    askedByUserId: "owner-1",
    requestedByUserId: "owner-1",
    parentTurnId: null,
    userMessage: "Draft two posts and upload the notes file.",
    capabilityNames: ["read_file", "create_social_post", "upload_file"],
    parentTurn: null,
    ...overrides,
  };
}

describe("evaluateTurnDoneCheck with completionDecider (E3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findManyChildTurns.mockResolvedValue([]);
    mocks.findManyDelegations.mockResolvedValue([]);
    mocks.findManyWatches.mockResolvedValue([]);
    mocks.findDelegation.mockResolvedValue(null);
    mocks.findWatch.mockResolvedValue(null);
    mocks.findChildTurn.mockResolvedValue(null);
    mocks.findToolCalls.mockResolvedValue([]);
    mocks.findFirstToolCall.mockResolvedValue(null);
    mocks.countPendingDecisions.mockResolvedValue(0);
    mocks.findFirstPendingDecision.mockResolvedValue(null);
    mocks.findFirstRuntimeEvent.mockResolvedValue(null);
    mocks.resolveRequestId.mockResolvedValue("turn-1");
    mocks.readRequestPlan.mockResolvedValue(null);
    mocks.append.mockResolvedValue(undefined);
    mocks.appendUnless.mockResolvedValue(true);
  });

  it("keeps planLoop-only versions on deterministic #8340 with zero Jev calls", async () => {
    mocks.findTurn.mockResolvedValue(baseTurn());
    mocks.resolveVersion.mockResolvedValue({ planLoop: true });
    mocks.readRequestPlan.mockResolvedValue({
      requestId: "turn-1",
      revision: 1,
      steps: [{ id: "s1", step: "Upload notes", status: "pending" }],
    });

    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Summary ready.",
    });

    expect(prompt).toContain("- s1 [pending] Upload notes");
    expect(mocks.evaluateWithJev).not.toHaveBeenCalled();
  });

  it("catches an early stop without a plan in standalone completionDecider mode and records a receipt", async () => {
    mocks.findTurn.mockResolvedValue(baseTurn());
    mocks.resolveVersion.mockResolvedValue({ completionDecider: true });
    mocks.evaluateWithJev.mockResolvedValue({
      answers: new Map([
        [
          "decision",
          {
            type: "choice",
            choice: "continue",
            probabilities: {
              finish: 0.05,
              continue: 0.9,
              ask_owner: 0.03,
              abstain: 0.02,
            },
          },
        ],
        [
          "target",
          {
            type: "choice",
            choice: "gap:incomplete_work",
            probabilities: {
              "gap:unread_context": 0.05,
              "gap:incomplete_work": 0.9,
              "gap:unsettled_receipt": 0.05,
            },
          },
        ],
      ]),
      costUsd: 0.00004,
    });

    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "I reviewed the files.",
    });

    expect(prompt).toContain("not backed by Core's receipts yet");
    expect(mocks.appendUnless).toHaveBeenCalledTimes(1);
    expect(mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMPLETION_DECIDER_EVENT,
        data: expect.objectContaining({
          choice: "continue",
          chosenTarget: "gap:incomplete_work",
          bounced: true,
          fallback: false,
        }),
      }),
    );
  });

  it("evaluates an owner-originated EVENT follow-up wake with the originating request", async () => {
    mocks.findTurn
      .mockResolvedValueOnce(
        baseTurn({
          id: "wake-1",
          source: "EVENT",
          askedByUserId: null,
          requestedByUserId: null,
          userMessage:
            "Delegated work changed status: Task COMPLETED. Your plan: Make visuals and draft post.",
        }),
      )
      .mockResolvedValueOnce(
        baseTurn({
          id: "chat-root",
          source: "CHAT",
          userMessage:
            "Have a coworker write a note, then make visuals and draft a post.",
        }),
      );
    mocks.resolveVersion.mockResolvedValue({ completionDecider: true });
    mocks.resolveRequestId.mockResolvedValue("chat-root");
    mocks.evaluateWithJev.mockResolvedValue({
      answers: new Map([
        [
          "decision",
          {
            type: "choice",
            choice: "continue",
            probabilities: {
              finish: 0.04,
              continue: 0.91,
              ask_owner: 0.03,
              abstain: 0.02,
            },
          },
        ],
        [
          "target",
          {
            type: "choice",
            choice: "gap:incomplete_work",
            probabilities: {
              "gap:unread_context": 0.04,
              "gap:incomplete_work": 0.92,
              "gap:unsettled_receipt": 0.04,
            },
          },
        ],
      ]),
      costUsd: 0.00005,
    });

    const prompt = await evaluateTurnDoneCheck({
      turnId: "wake-1",
      sessionId: "sess-wake",
      draft: "The coworker delivered the note.",
    });

    expect(prompt).toContain("Complete the remaining clear work now");
    const jevCall = mocks.evaluateWithJev.mock.calls[0]?.[0] as {
      state: Record<string, unknown>;
    };
    expect(jevCall.state.isFollowUpWake).toBe(true);
    expect(jevCall.state.originatingOwnerRequest).toContain(
      "make visuals and draft a post",
    );
  });

  it("skips built-in rhythms and teammate requests even when completionDecider is on", async () => {
    mocks.resolveVersion.mockResolvedValue({ completionDecider: true });

    mocks.findTurn.mockResolvedValueOnce(
      baseTurn({
        source: "SCHEDULE",
        requestedByUserId: null,
        askedByUserId: null,
      }),
    );
    await expect(
      evaluateTurnDoneCheck({
        turnId: "rhythm-1",
        sessionId: "s",
        draft: "Quiet.",
      }),
    ).resolves.toBeNull();

    mocks.findTurn.mockResolvedValueOnce(
      baseTurn({ askedByUserId: "teammate-2", requestedByUserId: "owner-1" }),
    );
    await expect(
      evaluateTurnDoneCheck({
        turnId: "team-1",
        sessionId: "s",
        draft: "Done.",
      }),
    ).resolves.toBeNull();

    expect(mocks.evaluateWithJev).not.toHaveBeenCalled();
  });

  it("falls back to #8340 planLoop done-check when combined and Jev abstains, marking fallback=true", async () => {
    mocks.findTurn.mockResolvedValue(baseTurn());
    mocks.resolveVersion.mockResolvedValue({
      planLoop: true,
      completionDecider: true,
    });
    mocks.readRequestPlan.mockResolvedValue({
      requestId: "turn-1",
      revision: 1,
      steps: [{ id: "s1", step: "Upload notes", status: "pending" }],
    });
    mocks.evaluateWithJev.mockResolvedValue({
      answers: new Map([
        [
          "decision",
          {
            type: "choice",
            choice: "abstain",
            probabilities: {
              finish: 0.2,
              continue: 0.2,
              ask_owner: 0.1,
              abstain: 0.5,
            },
          },
        ],
      ]),
      costUsd: 0.00003,
    });

    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Summary ready.",
    });

    expect(prompt).toContain("- s1 [pending] Upload notes");
    expect(mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMPLETION_DECIDER_EVENT,
        data: expect.objectContaining({
          abstained: true,
          validation: "abstained",
          fallback: true,
          fallbackPolicy: "plan_loop_done_check",
          bounced: true,
        }),
      }),
    );
  });

  it("suppresses an unnecessary #8340 bounce when combined and Jev sees receipts already completed the step", async () => {
    mocks.findTurn.mockResolvedValue(baseTurn());
    mocks.resolveVersion.mockResolvedValue({
      planLoop: true,
      completionDecider: true,
    });
    mocks.readRequestPlan.mockResolvedValue({
      requestId: "turn-1",
      revision: 1,
      steps: [{ id: "s1", step: "Upload notes.md", status: "pending" }],
    });
    mocks.findToolCalls.mockResolvedValue([
      {
        turnId: "turn-1",
        capability: "upload_file",
        status: "COMPLETED",
        disposition: "APPLIED",
        targetId: "file-1",
        result: { filename: "notes.md" },
        errorKind: null,
        errorDetail: null,
      },
    ]);
    mocks.evaluateWithJev.mockResolvedValue({
      answers: new Map([
        [
          "decision",
          {
            type: "choice",
            choice: "finish",
            probabilities: {
              finish: 0.94,
              continue: 0.03,
              ask_owner: 0.01,
              abstain: 0.02,
            },
          },
        ],
      ]),
      costUsd: 0.00004,
    });

    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Uploaded notes.md to Files.",
    });

    expect(prompt).toBeNull();
    expect(mocks.appendUnless).not.toHaveBeenCalled();
    expect(mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMPLETION_DECIDER_EVENT,
        data: expect.objectContaining({
          choice: "finish",
          validation: "valid",
          fallback: false,
          bounced: false,
        }),
      }),
    );
  });

  it("handles a bounce-claim race safely by recording stale fallback and returning null", async () => {
    mocks.findTurn.mockResolvedValue(baseTurn());
    mocks.resolveVersion.mockResolvedValue({ completionDecider: true });
    mocks.appendUnless.mockResolvedValue(false);
    mocks.evaluateWithJev.mockResolvedValue({
      answers: new Map([
        [
          "decision",
          {
            type: "choice",
            choice: "continue",
            probabilities: {
              finish: 0.05,
              continue: 0.9,
              ask_owner: 0.03,
              abstain: 0.02,
            },
          },
        ],
        [
          "target",
          {
            type: "choice",
            choice: "gap:incomplete_work",
            probabilities: {
              "gap:unread_context": 0.05,
              "gap:incomplete_work": 0.9,
              "gap:unsettled_receipt": 0.05,
            },
          },
        ],
      ]),
      costUsd: 0.00004,
    });

    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Not finished yet.",
    });

    expect(prompt).toBeNull();
    expect(mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMPLETION_DECIDER_EVENT,
        data: expect.objectContaining({
          validation: "stale",
          validationDetail: "bounce_claim_race",
          fallback: true,
          bounced: false,
        }),
      }),
    );
  });

  it("enforces cross-bot isolation on EVENT wakes", async () => {
    mocks.findTurn
      .mockResolvedValueOnce(
        baseTurn({
          id: "wake-1",
          sokoBotId: "bot-1",
          source: "EVENT",
          askedByUserId: null,
          requestedByUserId: null,
        }),
      )
      .mockResolvedValueOnce(
        baseTurn({
          id: "chat-other-bot",
          sokoBotId: "bot-2",
          source: "CHAT",
        }),
      );
    mocks.resolveVersion.mockResolvedValue({ completionDecider: true });
    mocks.resolveRequestId.mockResolvedValue("chat-other-bot");

    await expect(
      evaluateTurnDoneCheck({
        turnId: "wake-1",
        sessionId: "sess-1",
        draft: "Update received.",
      }),
    ).resolves.toBeNull();
    expect(mocks.evaluateWithJev).not.toHaveBeenCalled();
  });

  it("treats FAILED/UNKNOWN external effects (incl. paid investor_warm_paths) as unconfirmed and keeps refusals open when a retry is UNKNOWN", async () => {
    mocks.findTurn.mockResolvedValue(baseTurn());
    mocks.resolveVersion.mockResolvedValue({ completionDecider: true });
    // Returned in chronological (asc) order, as Prisma queries it.
    mocks.findToolCalls.mockResolvedValue([
      {
        turnId: "turn-1",
        capability: "investor_warm_paths",
        input: { research: true },
        status: "FAILED",
        disposition: "UNKNOWN",
        targetId: null,
        result: null,
        errorKind: "timeout",
        errorDetail: "Timed out after dispatch",
      },
      {
        turnId: "turn-1",
        capability: "create_social_post",
        input: {},
        status: "FAILED",
        disposition: "REJECTED",
        targetId: null,
        result: null,
        errorKind: "refused",
        errorDetail: "Multiple accounts match.",
      },
      {
        turnId: "turn-1",
        capability: "create_social_post",
        input: {},
        status: "COMPLETED",
        disposition: "UNKNOWN",
        targetId: null,
        result: null,
        errorKind: null,
        errorDetail: null,
      },
    ]);
    mocks.evaluateWithJev.mockResolvedValue({
      answers: new Map([
        [
          "decision",
          {
            type: "choice",
            choice: "finish",
            probabilities: {
              finish: 0.9,
              continue: 0.05,
              ask_owner: 0.03,
              abstain: 0.02,
            },
          },
        ],
      ]),
      costUsd: 0.00004,
    });

    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Checking status.",
    });

    const jevCall = mocks.evaluateWithJev.mock.calls[0]?.[0] as {
      questions: { decision: { criteria: Record<string, string> } };
      state: {
        coreWriteReceipts: Array<{ capability: string; outcome: string }>;
        readToolsUsed: Array<{ capability: string }>;
        unresolvedCoreRefusals: Array<{ capability: string }>;
      };
    };
    expect(Object.keys(jevCall.questions.decision.criteria)).toEqual([
      "continue",
      "ask_owner",
      "abstain",
    ]);
    expect(prompt).toContain("Core could not confirm");
    expect(prompt).toContain("read back");
    expect(mocks.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: COMPLETION_DECIDER_EVENT,
        data: expect.objectContaining({
          fallback: true,
          fallbackPolicy: "unconfirmed_readback",
          outcome: "continue",
          bounced: true,
        }),
      }),
    );
    expect(jevCall.state.coreWriteReceipts).toEqual([
      expect.objectContaining({
        capability: "investor_warm_paths",
        outcome: "unconfirmed",
      }),
      expect.objectContaining({
        capability: "create_social_post",
        outcome: "not done",
      }),
      expect.objectContaining({
        capability: "create_social_post",
        outcome: "unconfirmed",
      }),
    ]);
    expect(jevCall.state.readToolsUsed).toEqual([]);
    expect(jevCall.state.unresolvedCoreRefusals).toEqual([
      expect.objectContaining({ capability: "create_social_post" }),
    ]);
  });

  it("reads the full call set without a 100-call cap, preserves an early unconfirmed publish behind 105 reads and 20 uploads, and keeps the turn open for read-back", async () => {
    mocks.findTurn.mockResolvedValue(baseTurn());
    mocks.resolveVersion.mockResolvedValue({ completionDecider: true });
    mocks.findToolCalls.mockResolvedValue([
      {
        turnId: "turn-1",
        capability: "publish_social_post",
        input: {},
        status: "FAILED",
        disposition: "UNKNOWN",
        targetId: "post-1",
        result: null,
        errorKind: "timeout",
        errorDetail: "Provider response lost",
      },
      ...Array.from({ length: 105 }, () => ({
        turnId: "turn-1",
        capability: "read_file",
        input: {},
        status: "COMPLETED",
        disposition: "APPLIED",
        targetId: null,
        result: {},
        errorKind: null,
        errorDetail: null,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        turnId: "turn-1",
        capability: "upload_file",
        input: {},
        status: "COMPLETED",
        disposition: "APPLIED",
        targetId: `file-${i}`,
        result: { filename: `file-${i}.md` },
        errorKind: null,
        errorDetail: null,
      })),
    ]);
    mocks.evaluateWithJev.mockResolvedValue({
      answers: new Map([
        [
          "decision",
          {
            type: "choice",
            choice: "finish",
            probabilities: {
              finish: 0.9,
              continue: 0.05,
              ask_owner: 0.03,
              abstain: 0.02,
            },
          },
        ],
      ]),
      costUsd: 0.00004,
    });

    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Published the post and uploaded the files.",
    });

    expect(mocks.findToolCalls).toHaveBeenCalledWith(
      expect.not.objectContaining({ take: expect.anything() }),
    );
    expect(prompt).toContain(
      "publish_social_post (id post-1): Core could not confirm",
    );
    expect(prompt).toContain("read back");
    const jevCall = mocks.evaluateWithJev.mock.calls[0]?.[0] as {
      questions: { decision: { criteria: Record<string, string> } };
      state: {
        coreWriteReceipts: Array<{ capability: string; outcome: string }>;
        coreWriteReceiptsOverflow: {
          totalReceipts: number;
          shownReceipts: number;
          omittedDoneCount: number;
          omittedUnresolvedCount: number;
        };
        readToolsUsed: Array<{ capability: string; completedCount: number }>;
      };
    };
    expect(Object.keys(jevCall.questions.decision.criteria)).not.toContain(
      "finish",
    );
    expect(jevCall.state.coreWriteReceipts).toHaveLength(20);
    expect(jevCall.state.coreWriteReceipts[0]).toEqual(
      expect.objectContaining({
        capability: "publish_social_post",
        outcome: "unconfirmed",
      }),
    );
    expect(jevCall.state.coreWriteReceiptsOverflow).toEqual(
      expect.objectContaining({
        totalReceipts: 21,
        shownReceipts: 20,
        omittedDoneCount: 1,
        omittedUnresolvedCount: 0,
      }),
    );
    expect(jevCall.state.readToolsUsed).toEqual([
      expect.objectContaining({ capability: "read_file", completedCount: 105 }),
    ]);
  });

  it("still allows finish on a confirmed FAILED/REJECTED publish when the bot reports the refusal (negative control)", async () => {
    mocks.findTurn.mockResolvedValue(baseTurn());
    mocks.resolveVersion.mockResolvedValue({ completionDecider: true });
    mocks.findToolCalls.mockResolvedValue([
      {
        turnId: "turn-1",
        capability: "publish_social_post",
        input: {},
        status: "FAILED",
        disposition: "REJECTED",
        targetId: "post-1",
        result: null,
        errorKind: "refused",
        errorDetail: "Post requires owner approval before publishing",
      },
    ]);
    mocks.evaluateWithJev.mockResolvedValue({
      answers: new Map([
        [
          "decision",
          {
            type: "choice",
            choice: "finish",
            probabilities: {
              finish: 0.91,
              continue: 0.04,
              ask_owner: 0.03,
              abstain: 0.02,
            },
          },
        ],
      ]),
      costUsd: 0.00004,
    });

    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft:
        "Core refused to publish because the post still awaits your approval.",
    });

    const jevCall = mocks.evaluateWithJev.mock.calls[0]?.[0] as {
      questions: { decision: { criteria: Record<string, string> } };
    };
    expect(Object.keys(jevCall.questions.decision.criteria)).toContain(
      "finish",
    );
    expect(prompt).toBeNull();
    expect(mocks.appendUnless).not.toHaveBeenCalled();
  });
});
