import {
  DECISION_OUTCOME_EVENT,
  DECISION_RECEIPT_EVENT,
  getSokoBotVersion,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  agentFindFirst,
  evalResultFindMany,
  turnFindUnique,
  turnFindMany,
  delegationFindMany,
  watchFindMany,
  runtimeEventFindMany,
  runtimeEventFindFirst,
  runtimeEventCreate,
  contextSnapshotFindFirst,
  transactionMock,
  resolveVersionMock,
  loadPersonaMock,
  emitMock,
} = vi.hoisted(() => ({
  agentFindFirst: vi.fn(),
  evalResultFindMany: vi.fn(),
  turnFindUnique: vi.fn(),
  turnFindMany: vi.fn(),
  delegationFindMany: vi.fn(),
  watchFindMany: vi.fn(),
  runtimeEventFindMany: vi.fn(),
  runtimeEventFindFirst: vi.fn(),
  runtimeEventCreate: vi.fn(),
  contextSnapshotFindFirst: vi.fn(),
  transactionMock: vi.fn(),
  resolveVersionMock: vi.fn(),
  loadPersonaMock: vi.fn(),
  emitMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    agent: { findFirst: agentFindFirst },
    evalResult: { findMany: evalResultFindMany },
    sokoBotTurn: { findUnique: turnFindUnique, findMany: turnFindMany },
    sokoBotDelegation: { findMany: delegationFindMany },
    sokoBotWatch: { findMany: watchFindMany },
    sokoBotContextSnapshot: { findFirst: contextSnapshotFindFirst },
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

vi.mock("@/helpers/soko-bot-owner", () => ({
  loadSokoBotPersona: loadPersonaMock,
}));

vi.mock("@/lib/evlog", () => ({
  createCoreLogger: () => ({ set: vi.fn(), emit: emitMock }),
  recordCoreWarning: vi.fn(),
}));

import { getContext } from "@/services/soko-bot-runtime/context";
import { jevRoute } from "@/test/jev-routes";
import { JevTurnClassifier } from "./classifier";
import {
  buildRouteDecisionReceipt,
  emitStoredRouteDecisionReceipt,
  exportDecisionReceiptsFromDb,
  hasHireableMarketplaceAgent,
  receiptToReplayScenario,
  recordDecisionReceiptOnce,
  routeCandidatesForTurn,
  storedRouteDecisionReceipt,
} from "./decision-receipts";
import { logSokoBotRouteOutcome } from "./route-outcome";
import { RuntimeEventLog } from "./turn-loop";

describe("routeCandidatesForTurn & buildRouteDecisionReceipt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters out HIRE_AGENT on cmo versions, when no marketplace agent is online, and all write routes on bot-to-bot turns", async () => {
    const cmo = getSokoBotVersion("cmo-v25");
    const cmoMenu = routeCandidatesForTurn({ version: cmo });
    expect(cmoMenu.find((c) => c.id === "HIRE_AGENT")?.available).toBe(false);
    expect(cmoMenu.find((c) => c.id === "MANAGE_WORK")?.available).toBe(true);

    const noAgentsMenu = routeCandidatesForTurn({
      version: getSokoBotVersion("v37"),
      hasHireableAgent: false,
    });
    expect(noAgentsMenu.find((c) => c.id === "HIRE_AGENT")).toMatchObject({
      available: false,
      filteredOutReason: "no hireable marketplace agent online",
    });

    agentFindFirst.mockResolvedValueOnce({ id: "agent_override_1" });
    expect(await hasHireableMarketplaceAgent()).toBe(true);
    expect(agentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { metadataOverride: { apiBaseUrl: { not: null } } },
          ]),
        }),
      }),
    );

    const botMenu = routeCandidatesForTurn({
      version: getSokoBotVersion("v37"),
      askedByBot: true,
    });
    expect(botMenu.filter((c) => c.available).map((c) => c.id)).toEqual([
      "DIRECT_RESPONSE",
      "CLARIFY",
    ]);
  });

  it("captures actual offered routes, raw probabilities, low-confidence fallback, and scrubs secrets", async () => {
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
    expect(classified.rawDecision?.offeredCandidateIds).toContain("HIRE_AGENT");

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
    expect(receipt.offeredCandidateIds).toEqual(
      classified.rawDecision?.offeredCandidateIds,
    );
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

  it("flags stale HIRE_AGENT when the last marketplace agent goes offline during classification", async () => {
    const version = getSokoBotVersion("v37");
    const preCandidates = routeCandidatesForTurn({
      version,
      hasHireableAgent: true,
    });
    const classified = await new JevTurnClassifier(async () =>
      jevRoute("HIRE_AGENT"),
    ).classify("Book a marketplace agent", {
      projectIds: [],
      coworkerIds: [],
      agentIds: ["agent_1"],
      taskIds: [],
      jobIds: [],
    });
    const receipt = buildRouteDecisionReceipt({
      turnId: "turn_stale_agent",
      message: "Book a marketplace agent",
      classification: classified,
      version,
      source: "CHAT",
      personAsked: false,
      cmoOwnerRequest: false,
      candidatesAtClassification: preCandidates,
      liveHasHireableAgent: false,
      grantedCapabilities: ["hire_agent", "list_tasks"],
      now: "2026-11-27T06:00:00.000Z",
    });
    expect(
      receipt.candidates.find((c) => c.id === "HIRE_AGENT")?.available,
    ).toBe(true);
    expect(receipt.validation).toMatchObject({
      status: "stale",
      rejectedChoice: "HIRE_AGENT",
    });
    expect(receipt.fallback).toMatchObject({
      applied: true,
      reason: "stale_option",
    });
  });

  it("keeps raw decision receipts out of model-visible getContext / refresh_context results", async () => {
    const version = {
      ...getSokoBotVersion("v37"),
      decisionReceipts: true as const,
    };
    const receipt = buildRouteDecisionReceipt({
      turnId: "turn_ctx",
      message: "Save the revised caption.",
      classification: await new JevTurnClassifier(async () =>
        jevRoute("CLARIFY"),
      ).classify("Save the revised caption.", {
        projectIds: [],
        coworkerIds: [],
        agentIds: [],
        taskIds: [],
        jobIds: [],
      }),
      version,
      source: "CHAT",
      personAsked: true,
      cmoOwnerRequest: false,
      grantedCapabilities: ["list_tasks"],
    });
    contextSnapshotFindFirst.mockResolvedValueOnce({
      packet: { trigger: { source: "CHAT" } },
      hash: "h1",
      schemaVersion: 1,
      generatedAt: new Date("2026-11-27T06:00:00.000Z"),
    });
    resolveVersionMock.mockResolvedValueOnce(version);
    loadPersonaMock.mockResolvedValueOnce({ name: "Nova" });
    turnFindUnique.mockResolvedValueOnce({
      clientTurnId: "chat:1",
      source: "CHAT",
      route: "CLARIFY",
      classification: { decisionReceipt: receipt },
    });

    const ctx = await getContext(
      {
        authorize: vi.fn(async () => ({
          turn: { id: "turn_ctx", sokoBotId: "bot_1", versionId: "v37" },
          grant: { contextSnapshotId: "snap_1" },
        })),
      } as never,
      { sessionId: "sess_1", turnId: "turn_ctx" },
    );
    expect(ctx).not.toHaveProperty("routeDecisionReceipt");
    expect(ctx).not.toHaveProperty("decisionReceipt");
    expect(JSON.stringify(ctx)).not.toContain(receipt.receiptId);
  });
});

describe("runtime persistence, outcome gating, and approved dev-only export", () => {
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
    turnFindMany.mockResolvedValue([]);
    delegationFindMany.mockResolvedValue([]);
    watchFindMany.mockResolvedValue([]);
  });

  it("deduplicates route decision receipts by receiptId and emits via Core-internal helper", async () => {
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

    turnFindUnique.mockResolvedValueOnce({
      classification: { decisionReceipt: receipt },
    });
    runtimeEventFindFirst.mockResolvedValueOnce({ id: "evt_existing" });
    expect(await emitStoredRouteDecisionReceipt("turn_1", "sess_1")).toBe(
      false,
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

    resolveVersionMock.mockResolvedValueOnce(getSokoBotVersion("v37"));
    await logSokoBotRouteOutcome("turn_live");
    expect(runtimeEventCreate).not.toHaveBeenCalled();

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

  it("exports ONLY approved dev eval turn chains, never ordinary user chat or holdout chains, and leaves expect unlabelled", async () => {
    const failedCaptionReceipt = buildRouteDecisionReceipt({
      turnId: "turn_dev_1",
      message: "Save the revised caption.",
      classification: await new JevTurnClassifier(async () =>
        jevRoute("CLARIFY"),
      ).classify("Save the revised caption.", {
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

    // Approved dev result owns turn_dev_1; holdout owns turn_holdout_root -> turn_holdout_child.
    // An ordinary customer turn ("turn_customer_chat") is NOT in any dev eval result.
    evalResultFindMany
      .mockResolvedValueOnce([
        {
          id: "res_dev_1",
          runId: "run_dev_01",
          caseId: "owner-cuso-change-plan",
          turnId: "turn_dev_1",
          state: { steps: [{ turnIds: ["turn_dev_1"] }] },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "res_holdout_1",
          turnId: "turn_holdout_root",
          state: { steps: [{ turnIds: ["turn_holdout_root"] }] },
        },
      ]);
    turnFindMany
      .mockResolvedValueOnce([]) // dev children
      .mockResolvedValueOnce([{ id: "turn_holdout_child" }]) // holdout children
      .mockResolvedValueOnce([]); // holdout grandchildren

    runtimeEventFindMany
      .mockResolvedValueOnce([
        {
          turnId: "turn_dev_1",
          data: failedCaptionReceipt,
          turn: { clientTurnId: "lab:eval:res_dev_1:0" },
        },
      ])
      .mockResolvedValueOnce([
        {
          turnId: "turn_dev_1",
          data: {
            schemaVersion: 1,
            turnId: "turn_dev_1",
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

    const exported = await exportDecisionReceiptsFromDb({
      evalRunId: "run_dev_01",
      limit: 10,
    });
    // Query strictly restricts to positively approved dev turn IDs (never customer turns or holdout).
    expect(runtimeEventFindMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          turnId: { in: ["turn_dev_1"] },
        }),
      }),
    );
    expect(exported).toHaveLength(1);
    expect(exported[0]?.source).toBe(
      "dev-eval:run_dev_01:owner-cuso-change-plan",
    );
    // Critical: failed CLARIFY decision must NOT grade itself correct.
    expect(exported[0]?.expect).toBeUndefined();
    expect(exported[0]?.observedOutcome).toMatchObject({
      originalChoice: "CLARIFY",
      originalEffectiveChoice: "CLARIFY",
      writes: ["update_social_posts"],
    });

    // When no approved dev eval results exist, returns [] without scanning ordinary turns.
    vi.clearAllMocks();
    evalResultFindMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    expect(await exportDecisionReceiptsFromDb({ limit: 10 })).toEqual([]);
    expect(runtimeEventFindMany).not.toHaveBeenCalled();

    // Direct helper leaves expect omitted unless caller supplies an explicit reviewed label.
    const rawDirect = receiptToReplayScenario(failedCaptionReceipt, null);
    expect(rawDirect.expect).toBeUndefined();
    const reviewedDirect = receiptToReplayScenario(failedCaptionReceipt, null, {
      expect: { acceptedChoices: ["MANAGE_WORK"] },
    });
    expect(reviewedDirect.expect).toEqual({ acceptedChoices: ["MANAGE_WORK"] });
  });
});
