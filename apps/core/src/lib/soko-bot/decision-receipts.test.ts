import {
  DECISION_OUTCOME_EVENT,
  DECISION_RECEIPT_EVENT,
  getSokoBotVersion,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  evalResultFindMany,
  turnFindUnique,
  runtimeEventFindMany,
  runtimeEventFindFirst,
  runtimeEventCreate,
  transactionMock,
  resolveVersionMock,
  emitMock,
} = vi.hoisted(() => ({
  evalResultFindMany: vi.fn(),
  turnFindUnique: vi.fn(),
  runtimeEventFindMany: vi.fn(),
  runtimeEventFindFirst: vi.fn(),
  runtimeEventCreate: vi.fn(),
  transactionMock: vi.fn(),
  resolveVersionMock: vi.fn(),
  emitMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    evalResult: { findMany: evalResultFindMany },
    sokoBotTurn: { findUnique: turnFindUnique },
    sokoBotRuntimeEvent: {
      findMany: runtimeEventFindMany,
      findFirst: runtimeEventFindFirst,
      create: runtimeEventCreate,
    },
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/db/database-now", () => ({
  databaseNow: vi.fn(async () => new Date("2026-11-27T06:00:00.000Z")),
}));

vi.mock("@/services/soko-bot-version.service", () => ({
  resolveSokoBotVersion: resolveVersionMock,
}));

vi.mock("@/lib/evlog", () => ({
  createCoreLogger: () => ({ set: vi.fn(), emit: emitMock }),
  recordCoreWarning: vi.fn(),
}));

import { jevRoute } from "@/test/jev-routes";
import { JevTurnClassifier } from "./classifier";
import {
  buildRouteDecisionReceipt,
  exportDecisionReceiptsFromDb,
  receiptToReplayScenario,
  recordDecisionReceiptOnce,
  routeCandidatesForTurn,
  storedRouteDecisionReceipt,
} from "./decision-receipts";
import { logSokoBotRouteOutcome } from "./route-outcome";
import { RuntimeEventLog } from "./turn-loop";

describe("routeCandidatesForTurn & buildRouteDecisionReceipt", () => {
  it("filters out HIRE_AGENT on cmo versions and all write routes on bot-to-bot turns", () => {
    const cmo = getSokoBotVersion("cmo-v25");
    const cmoMenu = routeCandidatesForTurn({ version: cmo });
    expect(cmoMenu.find((c) => c.id === "HIRE_AGENT")?.available).toBe(false);
    expect(cmoMenu.find((c) => c.id === "MANAGE_WORK")?.available).toBe(true);

    const botMenu = routeCandidatesForTurn({
      version: getSokoBotVersion("v37"),
      askedByBot: true,
    });
    expect(botMenu.filter((c) => c.available).map((c) => c.id)).toEqual([
      "DIRECT_RESPONSE",
      "CLARIFY",
    ]);
  });

  it("captures raw probabilities, low-confidence fallback, and scrubs secrets", async () => {
    const classifier = new JevTurnClassifier(async () => ({
      ...jevRoute("MANAGE_WORK", { writeScope: "SOCIAL" }),
      answers: {
        ...(jevRoute("MANAGE_WORK", { writeScope: "SOCIAL" })
          .answers as object),
        route: {
          choice: "MANAGE_WORK",
          probabilities: { MANAGE_WORK: 0.55, CLARIFY: 0.45 },
        },
      },
    }));
    const classified = await classifier.classify(
      "Move posts using token sk-ant-secret12345678901234567890",
      {
        projectIds: [],
        coworkerIds: [],
        agentIds: [],
        taskIds: [],
        jobIds: [],
      },
    );
    expect(classified.rawDecision).toMatchObject({
      rawChoice: "MANAGE_WORK",
      abstained: true,
      fallbackApplied: true,
      fallbackReason: "low_confidence",
    });

    const receipt = buildRouteDecisionReceipt({
      turnId: "turn_1",
      message: "Move posts using token sk-ant-secret12345678901234567890",
      previousReply: null,
      classification: classified,
      version: getSokoBotVersion("v37"),
      source: "CHAT",
      personAsked: true,
      cmoOwnerRequest: false,
      grantedCapabilities: ["list_tasks"],
      now: "2026-11-27T06:00:00.000Z",
    });
    expect(receipt.choice).toBe("MANAGE_WORK");
    expect(receipt.abstain).toBe(true);
    expect(receipt.fallback).toMatchObject({
      applied: true,
      reason: "low_confidence",
      effectiveChoice: "CLARIFY",
    });
    expect(receipt.input.message).not.toContain(
      "sk-ant-secret12345678901234567890",
    );
    expect(storedRouteDecisionReceipt({ decisionReceipt: receipt })).toEqual(
      receipt,
    );
  });

  it("flags stale route selection when granted capabilities lack hire_agent at dispatch", async () => {
    const classified = await new JevTurnClassifier(async () =>
      jevRoute("HIRE_AGENT"),
    ).classify("Book a marketplace agent", {
      projectIds: [],
      coworkerIds: [],
      agentIds: [],
      taskIds: [],
      jobIds: [],
    });
    const receipt = buildRouteDecisionReceipt({
      turnId: "turn_stale",
      message: "Book a marketplace agent",
      classification: classified,
      version: getSokoBotVersion("v37"),
      source: "CHAT",
      personAsked: false,
      cmoOwnerRequest: false,
      grantedCapabilities: ["list_tasks"],
      now: "2026-11-27T06:00:00.000Z",
    });
    expect(receipt.validation).toMatchObject({
      status: "stale",
      rejectedChoice: "HIRE_AGENT",
    });
    expect(receipt.fallback).toMatchObject({
      applied: true,
      reason: "stale_option",
    });
  });
});

describe("runtime persistence, outcome gating, and export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) =>
        callback({
          $executeRaw: vi.fn(),
          sokoBotRuntimeEvent: {
            findFirst: runtimeEventFindFirst,
            create: runtimeEventCreate,
          },
        }),
    );
  });

  it("deduplicates route decision receipts by receiptId", async () => {
    const receipt = buildRouteDecisionReceipt({
      turnId: "turn_1",
      message: "List my tasks",
      classification: await new JevTurnClassifier(async () =>
        jevRoute("DIRECT_RESPONSE"),
      ).classify("List my tasks", {
        projectIds: [],
        coworkerIds: [],
        agentIds: [],
        taskIds: [],
        jobIds: [],
      }),
      version: getSokoBotVersion("v37"),
      source: "CHAT",
      personAsked: true,
      cmoOwnerRequest: false,
      grantedCapabilities: ["list_tasks"],
    });
    runtimeEventFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "evt_existing" });

    const log = new RuntimeEventLog("turn_1", "sess_1");
    expect(await recordDecisionReceiptOnce(log, receipt)).toBe(true);
    expect(await recordDecisionReceiptOnce(log, receipt)).toBe(false);
    expect(runtimeEventCreate).toHaveBeenCalledTimes(1);
    expect(runtimeEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ type: DECISION_RECEIPT_EVENT }),
      }),
    );
  });

  it("writes decision.outcome only when version.decisionReceipts is enabled", async () => {
    turnFindUnique.mockResolvedValue({
      sokoBotId: "bot_1",
      versionId: "v37",
      eveSessionId: "sess_1",
      source: "CHAT",
      status: "COMPLETED",
      route: "MANAGE_WORK",
      chainDepth: 0,
      classification: { confidence: 0.9 },
      usage: { inputTokens: 42_000, outputTokens: 800, costUsd: 0.03 },
      durationMs: 5_200,
      toolCalls: [
        {
          capability: "create_social_post",
          status: "COMPLETED",
          errorKind: null,
        },
      ],
    });

    // Live version without flag: no decision.outcome written.
    resolveVersionMock.mockResolvedValueOnce(getSokoBotVersion("v37"));
    await logSokoBotRouteOutcome("turn_live");
    expect(runtimeEventCreate).not.toHaveBeenCalled();

    // Test version with flag: writes decision.outcome once.
    resolveVersionMock.mockResolvedValueOnce({
      ...getSokoBotVersion("v37"),
      decisionReceipts: true,
    });
    runtimeEventFindFirst.mockResolvedValue(null);
    await logSokoBotRouteOutcome("turn_flagged");
    expect(runtimeEventCreate).toHaveBeenCalledTimes(1);
    expect(runtimeEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: DECISION_OUTCOME_EVENT,
          data: expect.objectContaining({
            writes: ["create_social_post"],
            routeDisagreed: false,
            inputTokens: 42_000,
          }),
        }),
      }),
    );
  });

  it("exports stored receipts joined with outcomes and excludes holdout turns", async () => {
    const receipt = buildRouteDecisionReceipt({
      turnId: "turn_exp",
      message: "Push launch posts to Thursday",
      classification: await new JevTurnClassifier(async () =>
        jevRoute("CLARIFY"),
      ).classify("Push launch posts to Thursday", {
        projectIds: [],
        coworkerIds: [],
        agentIds: [],
        taskIds: [],
        jobIds: [],
      }),
      version: getSokoBotVersion("cmo-v25"),
      source: "CHAT",
      personAsked: true,
      cmoOwnerRequest: true,
      grantedCapabilities: ["update_social_posts"],
    });
    const holdoutReceipt = {
      ...receipt,
      receiptId: "rcpt_holdout",
      turnId: "turn_holdout",
    };
    evalResultFindMany.mockResolvedValueOnce([
      {
        id: "eval_res_holdout",
        turnId: "turn_holdout_root",
        state: { steps: [{ turnIds: ["turn_holdout"] }] },
      },
    ]);
    runtimeEventFindMany
      .mockResolvedValueOnce([
        {
          turnId: "turn_holdout",
          data: holdoutReceipt,
          turn: {
            clientTurnId: "lab:eval:eval_res_holdout:0",
            parentTurnId: null,
          },
        },
        {
          turnId: "turn_exp",
          data: receipt,
          turn: { clientTurnId: "chat:1", parentTurnId: null },
        },
      ])
      .mockResolvedValueOnce([
        {
          turnId: "turn_exp",
          data: {
            schemaVersion: 1,
            turnId: "turn_exp",
            recordedAt: "2026-11-27T06:01:00.000Z",
            turnStatus: "COMPLETED",
            writes: ["update_social_posts"],
            toolCallCount: 2,
            toolErrors: 0,
            toolRefusals: 0,
            routeDisagreed: true,
            inputTokens: 80_000,
            outputTokens: 600,
            turnCostUsd: 0.05,
            turnDurationMs: 9_000,
          },
        },
      ]);

    const exported = await exportDecisionReceiptsFromDb({ limit: 10 });
    expect(evalResultFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { caseId: { startsWith: "owner-holdout-" } },
      }),
    );
    expect(exported).toHaveLength(1);
    expect(exported[0]?.id).toContain(receipt.receiptId);
    expect(exported[0]?.tags).toContain("route-disagreed");
    expect(exported[0]?.observedOutcome?.writes).toEqual([
      "update_social_posts",
    ]);

    const direct = receiptToReplayScenario(receipt, null);
    expect(direct.id).toContain(receipt.receiptId);
  });
});
