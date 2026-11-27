import { getSokoBotVersion, SOKO_BOT_TOOL_REFUSED } from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveSokoBotVersion: vi.fn(),
  readRequestPlan: vi.fn(),
  resolveRequestId: vi.fn(),
  turnFindUnique: vi.fn(),
  turnFindMany: vi.fn(),
  turnFindFirst: vi.fn(),
  delegationFindMany: vi.fn(),
  delegationFindFirst: vi.fn(),
  watchFindMany: vi.fn(),
  watchFindFirst: vi.fn(),
  pendingDecisionFindFirst: vi.fn(),
  toolCallFindMany: vi.fn(),
  toolCallFindFirst: vi.fn(),
  marketingStrategyFindFirst: vi.fn(),
  socialPostCount: vi.fn(),
  socialPostFindFirst: vi.fn(),
  appendUnless: vi.fn(),
}));

vi.mock("@/services/soko-bot-version.service", () => ({
  resolveSokoBotVersion: mocks.resolveSokoBotVersion,
}));

vi.mock("@/lib/soko-bot/request-chain", () => ({
  readRequestPlan: mocks.readRequestPlan,
  resolveRequestId: mocks.resolveRequestId,
}));

vi.mock("@/lib/soko-bot/turn-loop", () => ({
  changeTools: () => new Set<string>(),
  RECORDED_SAVES: {},
  RuntimeEventLog: class {
    appendUnless = mocks.appendUnless;
  },
  runtimeEvent: (type: string, payload: unknown) => ({ type, payload }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: {
      findUnique: mocks.turnFindUnique,
      findMany: mocks.turnFindMany,
      findFirst: mocks.turnFindFirst,
    },
    sokoBotDelegation: {
      findMany: mocks.delegationFindMany,
      findFirst: mocks.delegationFindFirst,
    },
    sokoBotWatch: {
      findMany: mocks.watchFindMany,
      findFirst: mocks.watchFindFirst,
    },
    sokoBotPendingDecision: {
      findFirst: mocks.pendingDecisionFindFirst,
    },
    sokoBotToolCall: {
      findMany: mocks.toolCallFindMany,
      findFirst: mocks.toolCallFindFirst,
    },
    marketingStrategy: {
      findFirst: mocks.marketingStrategyFindFirst,
    },
    socialPost: {
      count: mocks.socialPostCount,
      findFirst: mocks.socialPostFindFirst,
    },
  },
}));

import { triggerHints } from "./context-packet";
import {
  CMO_UPCOMING_POSTS_BOUNCED_EVENT,
  evaluateTurnDoneCheck,
} from "./done-check";

const PROJECT_ID = "01960001-0001-7001-8001-000000000010";

function cmoTurn(overrides: Record<string, unknown> = {}) {
  return {
    sokoBotId: "bot-cuso",
    versionId: "cmo-v25",
    source: "CHAT",
    userMessage: "From now on, no posts on Fridays.",
    chainDepth: 0,
    askedByUserId: "user-1",
    requestedByUserId: "user-1",
    parentTurnId: null,
    sokoBot: { projectId: PROJECT_ID },
    parentTurn: null,
    ...overrides,
  };
}

const baseCmo = getSokoBotVersion("cmo-v25");
const flaggedCmo = { ...baseCmo, cmoApplyChanges: true as const };
const flaggedPlanCmo = {
  ...baseCmo,
  planLoop: true as const,
  cmoApplyChanges: true as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveSokoBotVersion.mockResolvedValue(flaggedCmo);
  mocks.resolveRequestId.mockResolvedValue("turn-1");
  mocks.readRequestPlan.mockResolvedValue(null);
  mocks.turnFindUnique.mockResolvedValue(cmoTurn());
  mocks.turnFindMany.mockResolvedValue([]);
  mocks.turnFindFirst.mockResolvedValue(null);
  mocks.delegationFindMany.mockResolvedValue([]);
  mocks.delegationFindFirst.mockResolvedValue(null);
  mocks.watchFindMany.mockResolvedValue([]);
  mocks.watchFindFirst.mockResolvedValue(null);
  mocks.pendingDecisionFindFirst.mockResolvedValue(null);
  mocks.toolCallFindMany.mockResolvedValue([]);
  mocks.toolCallFindFirst.mockResolvedValue(null);
  mocks.marketingStrategyFindFirst.mockImplementation(
    async ({ where }: { where: { approvedAt: unknown } }) =>
      where.approvedAt === null ? { id: "strat-new" } : { id: "strat-live" },
  );
  mocks.socialPostCount.mockResolvedValue(4);
  mocks.socialPostFindFirst.mockResolvedValue(null);
  mocks.appendUnless.mockResolvedValue(true);
});

describe("cmoApplyChanges preference hint", () => {
  it("keeps flag-off preference hint unchanged and directs applying to upcoming posts when enabled", () => {
    const baseInput = {
      userId: "user-1",
      sokoBotId: "bot-cuso",
      workspaceId: "ws-1",
      sharedScope: null,
      source: "CHAT" as const,
      personAsked: true,
      classification: {
        schemaVersion: 1 as const,
        route: "MANAGE_WORK" as const,
        confidence: 0.9,
        rationaleSummary: "Owner stated a posting rule",
        requestedOutcome: "change cadence",
        candidateProjectIds: [],
        candidateCoworkerIds: [],
        candidateAgentIds: [],
        requiresClarification: false,
        requiresApproval: false,
        signals: {
          refersToEarlier: 0,
          aboutMail: 0,
          aboutTasks: 0,
          statesPreference: 0.9,
        },
      },
      capturedPreference: "No posts on Fridays",
    };

    const off = triggerHints(baseInput);
    expect(off[0]).toContain(
      "Tell the owner in one line what you will do differently",
    );
    expect(off[0]).not.toContain("upcoming unpublished posts");

    const on = triggerHints({ ...baseInput, cmoApplyChanges: true });
    expect(on[0]).toContain(
      "apply this change to any affected upcoming unpublished posts",
    );
    expect(on[0]).toContain("not only memory or an unapproved strategy draft");
    expect(on[0]).toContain("Unless the owner asked for a proposal-only");

    const proposalOnly = triggerHints({
      ...baseInput,
      cmoApplyChanges: true,
      turnMessage:
        "Draft an alternate strategy for my review. Leave the scheduled posts as they are.",
    });
    expect(proposalOnly[0]).toContain(
      "leave existing scheduled posts unchanged",
    );
    expect(proposalOnly[0]).not.toContain("apply this change to any affected");
  });
});

describe("evaluateTurnDoneCheck with cmoApplyChanges", () => {
  it("does nothing and makes zero strategy/post queries when flag is off", async () => {
    mocks.resolveSokoBotVersion.mockResolvedValue(baseCmo);

    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Done, the update is in the card below.",
    });

    expect(prompt).toBeNull();
    expect(mocks.marketingStrategyFindFirst).not.toHaveBeenCalled();
    expect(mocks.socialPostCount).not.toHaveBeenCalled();
  });

  it("bounces once when an unapproved strategy save leaves upcoming posts untouched even with no plan", async () => {
    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Done, the update is in the card below.",
    });

    expect(prompt).toContain("4 upcoming unpublished social posts");
    expect(prompt).toContain("list_social_posts");
    expect(prompt).toContain("update_social_posts");
    expect(mocks.appendUnless).toHaveBeenCalledWith(
      expect.objectContaining({ type: CMO_UPCOMING_POSTS_BOUNCED_EVENT }),
      [CMO_UPCOMING_POSTS_BOUNCED_EVENT],
    );

    // Second check on the same turn never bounces again.
    mocks.appendUnless.mockResolvedValueOnce(false);
    const second = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Checked the live posts and none were on Friday.",
    });
    expect(second).toBeNull();
  });

  it("still catches an unapplied strategy save when planLoop is on and all plan steps are marked done", async () => {
    mocks.resolveSokoBotVersion.mockResolvedValue(flaggedPlanCmo);
    mocks.readRequestPlan.mockResolvedValue({
      requestId: "turn-1",
      revision: 2,
      steps: [{ id: "1", step: "Update strategy", status: "done" }],
    });

    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Done.",
    });

    expect(prompt).toContain("4 upcoming unpublished social posts");
  });

  it("does not bounce on initial strategy creation (no approved strategy yet)", async () => {
    mocks.marketingStrategyFindFirst.mockImplementation(
      async ({ where }: { where: { approvedAt: unknown } }) =>
        where.approvedAt === null ? { id: "strat-first" } : null,
    );

    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "Your first strategy is ready for review.",
      }),
    ).toBeNull();
  });

  it("does not bounce when the strategy was already approved (e.g. auto-applied)", async () => {
    mocks.marketingStrategyFindFirst.mockImplementation(
      async ({ where }: { where: { approvedAt: unknown } }) =>
        where.approvedAt === null ? null : { id: "strat-live" },
    );

    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "Updated strategy and posts.",
      }),
    ).toBeNull();
  });

  it("does not bounce when the request already updated a post on the approved strategy, but still bounces if only an unrelated manual draft was edited", async () => {
    mocks.toolCallFindMany.mockImplementation(
      async ({ where }: { where?: { capability?: unknown } }) =>
        where?.capability
          ? [{ targetId: "post-manual", result: { id: "post-manual" } }]
          : [],
    );
    mocks.socialPostFindFirst.mockResolvedValueOnce(null);
    const unrelatedEdit = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Updated the strategy and a manual draft.",
    });
    expect(unrelatedEdit).toContain("4 upcoming unpublished social posts");

    mocks.toolCallFindMany.mockImplementation(
      async ({ where }: { where?: { capability?: unknown } }) =>
        where?.capability
          ? [{ targetId: "post-strat-1", result: { id: "post-strat-1" } }]
          : [],
    );
    mocks.socialPostFindFirst.mockResolvedValueOnce({ id: "post-strat-1" });
    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "Updated the strategy and moved the Friday posts.",
      }),
    ).toBeNull();
  });

  it("preserves the live posts when the owner asks for a proposal only or future-only change", async () => {
    mocks.turnFindUnique.mockResolvedValue(
      cmoTurn({
        userMessage:
          "Draft an alternate strategy for my review. Leave the scheduled posts as they are.",
      }),
    );
    const proposal = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft:
        "Your proposed strategy is ready for review. The running month is unchanged.",
    });
    expect(proposal ?? "").not.toContain(
      "apply the requested change to every affected post",
    );
    expect(proposal).toBeNull();

    mocks.turnFindUnique.mockResolvedValue(
      cmoTurn({
        userMessage: "Starting next month, skip Fridays.",
      }),
    );
    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "Saved the updated strategy for next month.",
      }),
    ).toBeNull();
  });

  it("recognizes saved post IDs from the actual update_social_posts receipt and ignores refused/stillSaving/notTried", async () => {
    mocks.toolCallFindMany.mockImplementation(async ({ where }) =>
      where?.capability
        ? [
            {
              targetId: null,
              result: {
                saved: [],
                refused: [{ postId: "calendar-post", problem: "conflict" }],
                stillSaving: "calendar-post-2",
                notTried: ["calendar-post-3"],
              },
            },
          ]
        : [],
    );
    mocks.socialPostFindFirst.mockImplementation(async ({ where }) =>
      where.id.in.includes("calendar-post") ? { id: "calendar-post" } : null,
    );
    const unsaved = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Updated the posts.",
    });
    expect(unsaved).toContain("list_social_posts");

    mocks.toolCallFindMany.mockImplementation(async ({ where }) =>
      where?.capability
        ? [
            {
              targetId: null,
              result: {
                saved: [
                  { postId: "calendar-post", revision: 2, status: "DRAFT" },
                ],
                refused: [],
              },
            },
          ]
        : [],
    );
    const saved = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "I updated the post you named.",
    });
    expect(saved).toBeNull();
  });

  it("applies an authorized change when the review is for the summary", async () => {
    mocks.turnFindUnique.mockResolvedValue(
      cmoTurn({
        userMessage:
          "Move this month's Friday posts to Thursday now, then send me a summary for my review.",
      }),
    );
    const prompt = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "Done.",
    });
    expect(prompt).toContain("list_social_posts");
  });

  it("does not count independent manual drafts as upcoming posts in the approved strategy", async () => {
    mocks.socialPostCount.mockImplementation(async ({ where }) =>
      where.marketingStrategyId === undefined ? 1 : 0,
    );
    const result = await evaluateTurnDoneCheck({
      turnId: "turn-1",
      sessionId: "sess-1",
      draft: "There are no posts in this strategy to update.",
    });
    expect(result).toBeNull();
  });

  it("does not bounce when a background run/watch is active, when blocked by a tool refusal, or when 0 upcoming posts exist", async () => {
    mocks.watchFindFirst.mockResolvedValueOnce({ id: "watch-1" });
    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "Waiting on the strategy run.",
      }),
    ).toBeNull();

    mocks.toolCallFindMany.mockImplementation(
      async ({ where }: { where?: { capability?: unknown } }) =>
        where?.capability
          ? []
          : [
              {
                capability: "update_social_posts",
                status: "FAILED",
                errorKind: SOKO_BOT_TOOL_REFUSED,
              },
            ],
    );
    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "Could not update posts because the action was refused.",
      }),
    ).toBeNull();
    mocks.toolCallFindMany.mockResolvedValue([]);

    mocks.socialPostCount.mockResolvedValueOnce(0);
    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "Saved the updated strategy.",
      }),
    ).toBeNull();
  });

  it("never bounces scheduled rhythms, child runs, bot-to-bot turns, or non-CMO versions", async () => {
    mocks.turnFindUnique.mockResolvedValueOnce(cmoTurn({ source: "SCHEDULE" }));
    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "Weekly proposal ready.",
      }),
    ).toBeNull();

    mocks.turnFindUnique.mockResolvedValueOnce(
      cmoTurn({ parentTurnId: "turn-parent" }),
    );
    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "DONE: strategy drafted.",
      }),
    ).toBeNull();

    mocks.turnFindUnique.mockResolvedValueOnce(cmoTurn({ chainDepth: 1 }));
    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "Done.",
      }),
    ).toBeNull();

    const personalFlagged = {
      ...getSokoBotVersion("v36"),
      cmoApplyChanges: true as const,
    };
    mocks.resolveSokoBotVersion.mockResolvedValueOnce(personalFlagged);
    expect(
      await evaluateTurnDoneCheck({
        turnId: "turn-1",
        sessionId: "sess-1",
        draft: "Done.",
      }),
    ).toBeNull();
  });
});
