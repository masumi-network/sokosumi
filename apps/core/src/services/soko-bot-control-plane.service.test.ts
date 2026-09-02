import { createHash } from "node:crypto";
import {
  SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
  SOKO_BOT_ROUTE_CAPABILITIES,
  SOKO_BOT_TEAMMATE_CAPABILITIES,
  type SokoBotRuntime,
} from "@sokosumi/soko-bot";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  adminActionCreateMock,
  adminActionFindFirstMock,
  adminActionFindManyMock,
  adminActionFindUniqueMock,
  botCreateMock,
  botFindFirstMock,
  botFindManyMock,
  botFindUniqueMock,
  botFindUniqueOrThrowMock,
  botCountMock,
  botUpdateManyMock,
  botUpdateMock,
  agentFindManyMock,
  settingFindUniqueMock,
  authoredVersionFindFirstMock,
  contextSnapshotFindUniqueMock,
  coworkerFindManyMock,
  getEnvMock,
  jobFindManyMock,
  memoryCreateMock,
  memoryFindFirstMock,
  memoryFindUniqueMock,
  projectFindManyMock,
  recordUsageMock,
  scheduleRunFindFirstMock,
  scheduleRunFindUniqueMock,
  scheduleRunUpdateMock,
  scheduleRunUpdateManyMock,
  scheduleFindFirstMock,
  scheduleCountMock,
  scheduleUpdateMock,
  transactionMock,
  transactionQueryRawMock,
  tokenSignMock,
  taskFindManyMock,
  turnCreateMock,
  turnGrantSignMock,
  turnFindFirstMock,
  turnFindManyMock,
  turnFindUniqueMock,
  turnCountMock,
  turnUpdateManyMock,
  workspaceFindFirstMock,
  availabilityMock,
} = vi.hoisted(() => ({
  adminActionCreateMock: vi.fn(),
  adminActionFindFirstMock: vi.fn(),
  adminActionFindManyMock: vi.fn(),
  adminActionFindUniqueMock: vi.fn(),
  botCreateMock: vi.fn(),
  botFindFirstMock: vi.fn(),
  botFindManyMock: vi.fn(),
  botFindUniqueMock: vi.fn(),
  botFindUniqueOrThrowMock: vi.fn(),
  botCountMock: vi.fn(),
  botUpdateManyMock: vi.fn(),
  botUpdateMock: vi.fn(),
  agentFindManyMock: vi.fn(),
  settingFindUniqueMock: vi.fn(),
  authoredVersionFindFirstMock: vi.fn(),
  contextSnapshotFindUniqueMock: vi.fn(),
  coworkerFindManyMock: vi.fn(),
  getEnvMock: vi.fn<
    () => {
      SOKO_BOT_CLASSIFIER_MODE: string;
      SOKO_BOT_ENABLED?: boolean;
    }
  >(() => ({ SOKO_BOT_CLASSIFIER_MODE: "rules" })),
  jobFindManyMock: vi.fn(),
  memoryCreateMock: vi.fn(),
  memoryFindFirstMock: vi.fn(),
  memoryFindUniqueMock: vi.fn(),
  projectFindManyMock: vi.fn(),
  recordUsageMock: vi.fn(),
  scheduleRunFindFirstMock: vi.fn(),
  scheduleRunFindUniqueMock: vi.fn(),
  scheduleRunUpdateMock: vi.fn(),
  scheduleRunUpdateManyMock: vi.fn(),
  scheduleFindFirstMock: vi.fn(),
  scheduleCountMock: vi.fn(),
  scheduleUpdateMock: vi.fn(),
  transactionMock: vi.fn(),
  transactionQueryRawMock: vi.fn(),
  tokenSignMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  turnCreateMock: vi.fn(),
  turnGrantSignMock: vi.fn(),
  turnFindFirstMock: vi.fn(),
  turnFindManyMock: vi.fn(),
  turnFindUniqueMock: vi.fn(),
  turnCountMock: vi.fn(),
  turnUpdateManyMock: vi.fn(),
  workspaceFindFirstMock: vi.fn(),
  availabilityMock: vi.fn(),
}));

vi.mock("@/services/soko-bot-chat.service", () => ({
  ensureSokoBotCoworker: vi.fn().mockResolvedValue({ id: "cw", slug: "soko" }),
  finalizeSokoBotChatTurn: vi.fn().mockResolvedValue(undefined),
  deliverSokoBotTurnToDirectRoom: vi.fn().mockResolvedValue(undefined),
  publishSokoBotChatProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: availabilityMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    agent: { findMany: agentFindManyMock },
    // Creation resolves the promoted default version before its transaction.
    sokoBotSetting: { findUnique: settingFindUniqueMock },
    sokoBotAuthoredVersion: { findFirst: authoredVersionFindFirstMock },
    coworker: { findMany: coworkerFindManyMock },
    job: { findMany: jobFindManyMock },
    project: { findMany: projectFindManyMock },
    sokoBot: {
      count: botCountMock,
      findFirst: botFindFirstMock,
      findMany: botFindManyMock,
      findUnique: botFindUniqueMock,
      findUniqueOrThrow: botFindUniqueOrThrowMock,
      update: botUpdateMock,
    },
    sokoBotTurn: {
      count: turnCountMock,
      findFirst: turnFindFirstMock,
      findMany: turnFindManyMock,
      findUnique: turnFindUniqueMock,
      updateMany: turnUpdateManyMock,
    },
    sokoBotContextSnapshot: { findUnique: contextSnapshotFindUniqueMock },
    sokoBotMemoryRevision: {
      findFirst: memoryFindFirstMock,
      findUnique: memoryFindUniqueMock,
    },
    sokoBotSchedule: {
      findFirst: scheduleFindFirstMock,
      update: scheduleUpdateMock,
    },
    sokoBotScheduleRun: {
      findFirst: scheduleRunFindFirstMock,
      findUnique: scheduleRunFindUniqueMock,
      update: scheduleRunUpdateMock,
      updateMany: scheduleRunUpdateManyMock,
    },
    sokoBotAdminAction: {
      create: adminActionCreateMock,
      findFirst: adminActionFindFirstMock,
      findMany: adminActionFindManyMock,
      findUnique: adminActionFindUniqueMock,
    },
    task: { findMany: taskFindManyMock },
    workspace: { findFirst: workspaceFindFirstMock },
  },
}));
vi.mock("@/lib/soko-bot/factory", () => ({
  getSokoBotRuntime: () => ({}),
  getSokoBotTokenService: () =>
    Promise.resolve({
      signRequestToken: tokenSignMock,
      signTurnGrant: turnGrantSignMock,
    }),
}));
vi.mock("@/services/soko-bot-billing.service", () => ({
  recordSokoBotTurnUsage: recordUsageMock,
  requireSokoBotTurnFunding: vi.fn(),
}));

import { ExternalTurnClassifier } from "@/lib/soko-bot/classifier";
import {
  type BuiltContextPacket,
  ContextPacketBuilder,
} from "@/lib/soko-bot/context-packet";
import { SokoBotControlPlane } from "@/services/soko-bot-control-plane.service";

const BOT_ID = "01960001-0001-7001-8001-000000000001";

function adminRetryOperationKey(operationId: string): string {
  return createHash("sha256").update(operationId).digest("hex").slice(0, 32);
}

function adminBot(overrides: Record<string, unknown> = {}) {
  return {
    id: BOT_ID,
    userId: "user_1",
    archivedAt: null,
    status: "IDLE",
    adminPausedAt: null,
    eveSessionId: null,
    memoryVersion: 1,
    runtimeVersion: "eve-test",
    versionId: null as string | null,
    turns: [],
    ...overrides,
  };
}

async function* emptyEventStream() {}

function runtimeWithReset(
  resetSession: SokoBotRuntime["resetSession"],
): SokoBotRuntime {
  return {
    createSession: vi.fn(),
    streamEvents: vi.fn(() => emptyEventStream()),
    cancelTurn: vi.fn(),
    resetSession,
    inspectSession: vi.fn(),
  };
}

function transactionClient() {
  return {
    $queryRaw: transactionQueryRawMock,
    sokoBot: {
      create: botCreateMock,
      findFirst: botFindFirstMock,
      findUnique: botFindUniqueMock,
      update: botUpdateMock,
      updateMany: botUpdateManyMock,
    },
    sokoBotAdminAction: {
      create: adminActionCreateMock,
      findMany: adminActionFindManyMock,
    },
    sokoBotMemoryRevision: {
      create: memoryCreateMock,
      findUnique: memoryFindUniqueMock,
    },
    sokoBotSchedule: {
      count: scheduleCountMock,
      update: scheduleUpdateMock,
    },
    sokoBotScheduleRun: {
      findUnique: scheduleRunFindUniqueMock,
      update: scheduleRunUpdateMock,
      updateMany: scheduleRunUpdateManyMock,
    },
    sokoBotTurn: {
      count: turnCountMock,
      create: turnCreateMock,
      findFirst: turnFindFirstMock,
      findUnique: turnFindUniqueMock,
      updateMany: turnUpdateManyMock,
    },
  };
}

function builtContext(memoryVersion = 1): BuiltContextPacket {
  return {
    packet: {
      schemaVersion: 1,
      generatedAt: "2026-08-18T12:00:00.000Z",
      hash: "context-hash",
      trigger: {
        source: "CHAT",
        route: "DIRECT_RESPONSE",
        confidence: 1,
        requestedOutcome: "Hello",
        askedBy: { kind: "OWNER", name: "Owner", trust: "untrusted-data" },
      },
      actor: {},
      workspace: {},
      projects: [],
      tasks: [],
      coworkers: [],
      agents: [],
      jobs: [],
      pendingDecisions: [],
      recentTurns: [],
      memory: {
        version: memoryVersion,
        hash: `memory-hash-${memoryVersion}`,
        markdown: `memory v${memoryVersion}`,
      },
      counts: {},
      omissions: {},
    },
    byteSize: 100,
    tokenEstimate: 25,
    counts: {},
    omissions: {},
  };
}

describe("SokoBotControlPlane lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    availabilityMock.mockResolvedValue({
      disabled: false,
      disabledAt: null,
      disabledReason: null,
    });
    getEnvMock.mockReturnValue({ SOKO_BOT_CLASSIFIER_MODE: "rules" });
    adminActionCreateMock.mockResolvedValue({});
    adminActionFindFirstMock.mockResolvedValue(null);
    adminActionFindManyMock.mockResolvedValue([]);
    tokenSignMock.mockResolvedValue("signed-request-token");
    turnGrantSignMock.mockResolvedValue("signed-turn-grant");
    transactionQueryRawMock.mockResolvedValue([{ id: BOT_ID }]);
    turnUpdateManyMock.mockResolvedValue({ count: 1 });
    botUpdateManyMock.mockResolvedValue({ count: 1 });
    agentFindManyMock.mockResolvedValue([]);
    coworkerFindManyMock.mockResolvedValue([]);
    jobFindManyMock.mockResolvedValue([]);
    projectFindManyMock.mockResolvedValue([]);
    taskFindManyMock.mockResolvedValue([]);
    workspaceFindFirstMock.mockResolvedValue({ id: "workspace_1" });
    memoryFindUniqueMock.mockResolvedValue({ id: "memory_v1", version: 1 });
    scheduleCountMock.mockResolvedValue(0);
    scheduleRunFindFirstMock.mockResolvedValue(null);
    scheduleRunFindUniqueMock.mockResolvedValue(null);
    scheduleRunUpdateMock.mockResolvedValue({});
    scheduleRunUpdateManyMock.mockResolvedValue({ count: 1 });
    recordUsageMock.mockResolvedValue({
      chargedCents: 0n,
      expectedCents: 0n,
      shortfall: false,
    });
    transactionMock.mockImplementation(
      async (callback: (tx: ReturnType<typeof transactionClient>) => unknown) =>
        callback(transactionClient()),
    );
  });

  it("never reactivates a deleted bot into the owner's new assistant", async () => {
    // The tombstone still holds this (userId, workspaceId), so create() has to
    // look past it — otherwise deleting and starting over returns the old bot.
    botFindFirstMock.mockResolvedValue(null);
    botCreateMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-00000000ffff",
    });

    await new SokoBotControlPlane().create({
      userId: "user_1",
      workspaceId: "ws_1",
      name: "Fresh",
    });

    expect(botFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ deletedAt: null }),
      }),
    );
    expect(botCreateMock).toHaveBeenCalled();
    expect(botUpdateMock).not.toHaveBeenCalled();
  });

  it("preserves an administrator pause during profile updates", async () => {
    botFindFirstMock.mockResolvedValue({
      id: BOT_ID,
      archivedAt: null,
      adminPausedAt: null,
      status: "PAUSED",
      memoryVersion: 1,
    });
    botUpdateMock.mockResolvedValue({ id: BOT_ID, status: "PAUSED" });

    await new SokoBotControlPlane().create({
      userId: "user_1",
      workspaceId: "ws_1",
      name: "Soko",
    });

    expect(botUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          archivedAt: undefined,
          status: undefined,
        }),
      }),
    );
  });

  it("cursor-paginates user turns with a stable ID cursor", async () => {
    botFindFirstMock.mockResolvedValue({ id: BOT_ID });
    turnFindManyMock.mockResolvedValue([
      { id: "turn_3" },
      { id: "turn_2" },
      { id: "turn_1" },
    ]);
    turnCountMock.mockResolvedValue(9);

    const result = await new SokoBotControlPlane().listTurns("user_1", "ws_1", {
      cursor: "turn_4",
      take: 2,
    });

    expect(turnFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sokoBotId: BOT_ID },
        cursor: { id: "turn_4" },
        skip: 1,
        take: 3,
      }),
    );
    expect(result).toEqual({
      turns: [{ id: "turn_3" }, { id: "turn_2" }],
      count: 9,
      hasMore: true,
    });
  });

  it("cursor-paginates admin fleet search", async () => {
    botFindManyMock.mockResolvedValue([
      { id: "bot_3" },
      { id: "bot_2" },
      { id: "bot_1" },
    ]);
    botCountMock.mockResolvedValue(5);
    transactionMock.mockImplementationOnce(async (queries) =>
      Promise.all(queries),
    );

    const result = await new SokoBotControlPlane().listForAdmin(" Ada ", {
      cursor: "bot_4",
      take: 2,
    });

    expect(botFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: "bot_4" },
        skip: 1,
        take: 3,
        where: expect.objectContaining({ OR: expect.any(Array) }),
      }),
    );
    expect(result).toEqual({
      items: [{ id: "bot_3" }, { id: "bot_2" }],
      total: 5,
      hasMore: true,
    });
  });

  it("reactivates an archived bot explicitly", async () => {
    // create() looks up the live row with findFirst so a deleted tombstone can
    // never be reactivated into the owner's new assistant.
    botFindFirstMock.mockResolvedValue({
      id: BOT_ID,
      archivedAt: new Date(),
      adminPausedAt: null,
      status: "PAUSED",
      memoryVersion: 1,
    });
    botUpdateMock.mockResolvedValue({ id: BOT_ID, status: "IDLE" });

    await new SokoBotControlPlane().create({
      userId: "user_1",
      workspaceId: "ws_1",
      name: "Soko",
    });

    expect(botUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ archivedAt: null, status: "IDLE" }),
      }),
    );
  });

  it("preserves an administrator pause across owner reactivation", async () => {
    const pausedAt = new Date("2026-08-18T10:00:00.000Z");
    botFindFirstMock.mockResolvedValue({
      id: BOT_ID,
      archivedAt: new Date(),
      adminPausedAt: pausedAt,
      status: "PAUSED",
      memoryVersion: 1,
    });
    botUpdateMock.mockResolvedValue({
      id: BOT_ID,
      archivedAt: null,
      adminPausedAt: pausedAt,
      status: "PAUSED",
    });

    await new SokoBotControlPlane().create({
      userId: "user_1",
      workspaceId: "ws_1",
      name: "Soko",
    });

    expect(botUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          archivedAt: null,
          status: undefined,
        }),
      }),
    );
  });

  it("refuses a turn whenever durable administrator pause is set", async () => {
    botFindFirstMock.mockResolvedValue(
      adminBot({
        status: "IDLE",
        adminPausedAt: new Date("2026-08-18T10:00:00.000Z"),
      }),
    );

    await expect(
      new SokoBotControlPlane().startTurn({
        userId: "user_1",
        workspaceId: "workspace_1",
        clientTurnId: "turn-request-1",
        message: "Hello",
      }),
    ).rejects.toThrow("Soko Bot is paused");

    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("replays an exact normalized client turn while paused", async () => {
    botFindFirstMock.mockResolvedValue(
      adminBot({
        status: "PAUSED",
        adminPausedAt: new Date("2026-08-18T10:00:00.000Z"),
      }),
    );
    turnFindUniqueMock.mockResolvedValue({
      id: "turn_existing",
      sokoBotId: BOT_ID,
      workspaceId: "workspace_1",
      source: "CHAT",
      userMessage: "Hello",
      eveSessionId: "session_1",
      status: "COMPLETED",
      route: "DIRECT_RESPONSE",
      capabilityNames: [],
      errorKind: null,
      leaseToken: null,
    });

    const result = await new SokoBotControlPlane().startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "client-turn-1",
      message: "  Hello  ",
    });

    expect(result).toMatchObject({
      turnId: "turn_existing",
      status: "COMPLETED",
      duplicate: true,
    });
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("rejects a mismatched client turn before pause policy", async () => {
    botFindFirstMock.mockResolvedValue(
      adminBot({
        status: "PAUSED",
        adminPausedAt: new Date("2026-08-18T10:00:00.000Z"),
      }),
    );
    turnFindUniqueMock.mockResolvedValue({
      id: "turn_existing",
      sokoBotId: BOT_ID,
      workspaceId: "workspace_1",
      source: "CHAT",
      userMessage: "Original",
      eveSessionId: "session_1",
      status: "COMPLETED",
      route: "DIRECT_RESPONSE",
      capabilityNames: [],
      errorKind: null,
      leaseToken: null,
    });

    await expect(
      new SokoBotControlPlane().startTurn({
        userId: "user_1",
        workspaceId: "workspace_1",
        clientTurnId: "client-turn-1",
        message: "Changed",
      }),
    ).rejects.toThrow("Client turn id was already used for different input");
  });

  it("retries an ambiguously accepted turn with the same durable operation id", async () => {
    botFindFirstMock.mockResolvedValue(
      adminBot({
        status: "RUNNING",
        eveSessionId: "session_bound_after_lost_response",
      }),
    );
    turnFindUniqueMock.mockResolvedValue({
      id: "turn_existing",
      sokoBotId: BOT_ID,
      userId: "user_1",
      workspaceId: "workspace_1",
      source: "CHAT",
      userMessage: "Hello",
      eveSessionId: "session_bound_after_lost_response",
      status: "STARTING",
      route: "DIRECT_RESPONSE",
      capabilityNames: [],
      errorKind: "runtime_start_ambiguous",
      leaseToken: "lease_1",
      deadlineAt: new Date("2099-08-18T12:00:00.000Z"),
    });
    contextSnapshotFindUniqueMock.mockResolvedValue({
      id: "snapshot_1",
      packet: builtContext().packet,
    });
    memoryFindFirstMock.mockResolvedValue(null);
    const createSession = vi
      .fn<SokoBotRuntime["createSession"]>()
      .mockRejectedValueOnce(
        new DOMException("response timeout after accept", "TimeoutError"),
      )
      .mockResolvedValueOnce({
        sessionId: "session_bound_after_lost_response",
        runtimeVersion: "eve-test",
        acceptedAt: "2026-08-18T12:00:00.000Z",
      });
    const resetSession = vi.fn<SokoBotRuntime["resetSession"]>();
    const runtime = runtimeWithReset(resetSession);
    runtime.createSession = createSession;

    const result = await new SokoBotControlPlane(runtime).startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "client-turn-1",
      message: "Hello",
    });

    expect(createSession).toHaveBeenCalledTimes(2);
    expect(createSession).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ turnId: "turn_existing", sessionId: null }),
    );
    expect(createSession).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ turnId: "turn_existing", sessionId: null }),
    );
    expect(result).toMatchObject({
      turnId: "turn_existing",
      sessionId: "session_bound_after_lost_response",
      status: "RUNNING",
      duplicate: true,
      reconciliationLeaseToken: "lease_1",
    });
    expect(resetSession).not.toHaveBeenCalled();
  });

  it("grants the memory revision persisted in the snapshot when reset happened later", async () => {
    botFindFirstMock.mockResolvedValue(adminBot({ status: "RUNNING" }));
    turnFindUniqueMock.mockResolvedValue({
      id: "turn_existing",
      sokoBotId: BOT_ID,
      userId: "user_1",
      workspaceId: "workspace_1",
      source: "CHAT",
      userMessage: "Hello",
      eveSessionId: null,
      status: "STARTING",
      route: "DIRECT_RESPONSE",
      capabilityNames: [],
      errorKind: "runtime_start_ambiguous",
      leaseToken: "lease_1",
      deadlineAt: new Date("2099-08-18T12:00:00.000Z"),
    });
    contextSnapshotFindUniqueMock.mockResolvedValue({
      id: "snapshot_1",
      packet: builtContext().packet,
    });
    memoryFindFirstMock.mockResolvedValue({ id: "memory_v2", version: 2 });
    memoryFindUniqueMock.mockResolvedValue({ id: "memory_v1", version: 1 });
    const runtime = runtimeWithReset(vi.fn());
    runtime.createSession = vi.fn().mockResolvedValue({
      sessionId: "session_1",
      runtimeVersion: "eve-test",
      acceptedAt: "2026-08-18T12:00:00.000Z",
    });

    await new SokoBotControlPlane(runtime).startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "client-turn-1",
      message: "Hello",
    });

    expect(memoryFindFirstMock).not.toHaveBeenCalled();
  });

  it("does not clean up or settle after a watchdog replaces the start lease", async () => {
    const replacement = {
      id: "turn_fresh",
      sokoBotId: BOT_ID,
      userId: "user_1",
      workspaceId: "workspace_1",
      source: "CHAT",
      userMessage: "Hello",
      eveSessionId: null,
      status: "STARTING",
      route: "DIRECT_RESPONSE",
      capabilityNames: [],
      errorKind: "runtime_start_ambiguous",
      leaseToken: "watchdog_lease",
      startedAt: null,
      costUsdMicros: 0n,
      scheduleRun: null,
    };
    botFindFirstMock.mockResolvedValue(adminBot());
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValue(replacement);
    turnFindFirstMock.mockResolvedValue(null);
    turnCreateMock.mockResolvedValue({
      ...replacement,
      leaseToken: "old_lease",
    });
    const resetSession = vi.fn<SokoBotRuntime["resetSession"]>();
    const runtime = runtimeWithReset(resetSession);
    runtime.createSession = vi.fn().mockResolvedValue({
      sessionId: "shared_session",
      runtimeVersion: "eve-test",
      acceptedAt: "2026-08-18T12:00:00.000Z",
    });
    let releaseAcknowledgement!: () => void;
    const acknowledgementBarrier = new Promise<void>((resolve) => {
      releaseAcknowledgement = resolve;
    });
    turnUpdateManyMock.mockImplementationOnce(async () => {
      await acknowledgementBarrier;
      return { count: 0 };
    });
    const contextBuilder = {
      build: vi.fn().mockResolvedValue(builtContext()),
    } as ContextPacketBuilder;

    const pending = new SokoBotControlPlane(
      runtime,
      contextBuilder,
      new ExternalTurnClassifier(false),
    ).startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "client-turn-1",
      message: "Hello",
    });
    await vi.waitFor(() => expect(turnUpdateManyMock).toHaveBeenCalledOnce());
    releaseAcknowledgement();

    await expect(pending).rejects.toThrow(
      "stopped before runtime acknowledgement",
    );
    expect(resetSession).not.toHaveBeenCalled();
    expect(turnUpdateManyMock).toHaveBeenCalledOnce();
  });

  it("starts no turn at all while an administrator has it switched off", async () => {
    // The switch has to mean "no model calls", so it is refused at the single
    // point every turn passes through rather than per entry point.
    availabilityMock.mockResolvedValue({
      disabled: true,
      disabledAt: new Date(),
      disabledReason: "Paused while we investigate",
    });

    await expect(
      new SokoBotControlPlane().startTurn({
        userId: "user_1",
        workspaceId: "workspace_1",
        clientTurnId: "client-turn-off",
        message: "Hello",
      }),
    ).rejects.toThrow(/investigate/i);

    expect(turnCreateMock).not.toHaveBeenCalled();
  });

  it("grants a teammate mention only the teammate ceiling", async () => {
    // The bot answers into a shared room, so the owner's private reads must
    // not be on the grant and the packet must be built for a teammate.
    botFindFirstMock.mockResolvedValue(adminBot());
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue(null);
    turnCreateMock.mockResolvedValue({
      id: "turn_teammate",
      leaseToken: "turn_lease",
    });
    const runtime = runtimeWithReset(vi.fn());
    runtime.createSession = vi.fn().mockResolvedValue({
      sessionId: "session_teammate",
      runtimeVersion: "eve-test",
      acceptedAt: "2026-08-18T12:00:00.000Z",
    });
    const contextBuilder = {
      build: vi.fn().mockResolvedValue(builtContext()),
    } as ContextPacketBuilder;

    await new SokoBotControlPlane(
      runtime,
      contextBuilder,
      new ExternalTurnClassifier(false),
    ).startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "client-turn-teammate",
      message: "What did Jane email yesterday, and what files are in Drive?",
      chat: {
        mentionId: "mention_1",
        responseMessageId: "message_1",
        requestedByUserId: "user_teammate",
      },
    });

    const granted = turnCreateMock.mock.calls[0]?.[0]?.data
      ?.capabilityNames as string[];
    expect(granted).toEqual([...SOKO_BOT_TEAMMATE_CAPABILITIES]);
    for (const ownerPrivate of [
      "search_inbox",
      "read_email",
      "list_calendar_events",
      "list_files",
      "read_memory",
      "read_chat",
    ]) {
      expect(granted).not.toContain(ownerPrivate);
    }
    // The packet's `actor` is the owner on every turn, so the asker's id has
    // to travel with the audience or the bot cannot tell who it is answering.
    expect(contextBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({
        audience: "TEAMMATE",
        askedByKind: "TEAMMATE",
        askedByUserId: "user_teammate",
      }),
    );
  });

  it("grants a self-started turn the same spend it grants the owner", async () => {
    // Withholding only `hire_agent` from scheduled turns read as a spend limit
    // and was not one: assigning a Task to a Coworker bills the owner just as
    // a hire does, and was never withheld. The cap and the prompt are the
    // brakes, not a half-closed door.
    botFindFirstMock.mockResolvedValue(adminBot());
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue(null);
    turnCreateMock.mockResolvedValue({
      id: "turn_scheduled",
      leaseToken: "turn_lease",
    });
    const runtime = runtimeWithReset(vi.fn());
    runtime.createSession = vi.fn().mockResolvedValue({
      sessionId: "session_scheduled",
      runtimeVersion: "eve-test",
      acceptedAt: "2026-08-18T12:00:00.000Z",
    });
    const contextBuilder = {
      build: vi.fn().mockResolvedValue(builtContext()),
    } as ContextPacketBuilder;

    await new SokoBotControlPlane(
      runtime,
      contextBuilder,
      new ExternalTurnClassifier(false),
    ).startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "client-turn-scheduled",
      // Routes deterministically to HIRE_AGENT, the one ceiling that carries
      // `hire_agent` — otherwise the assertion below passes either way.
      message: "Hire a marketplace agent to produce the competitor teardown.",
      source: "SCHEDULE",
    });

    const granted = turnCreateMock.mock.calls[0]?.[0]?.data
      ?.capabilityNames as string[];
    expect(turnCreateMock.mock.calls[0]?.[0]?.data?.route).toBe("HIRE_AGENT");
    expect(granted).toContain("hire_agent");
    expect(granted).toEqual([...SOKO_BOT_ROUTE_CAPABILITIES.HIRE_AGENT]);
  });

  it("refuses a bot-asked turn while the owner has paused unprompted work", async () => {
    // Counting these turns without enforcing would leave a setting the owner
    // can see doing nothing to the turn it is meant to stop.
    botFindFirstMock.mockResolvedValue(adminBot());
    botFindUniqueMock.mockResolvedValue(adminBot());
    botFindUniqueOrThrowMock.mockResolvedValue({
      userId: "user_1",
      proactivePaused: true,
      proactiveDailyLimit: 20,
      ingestTimezone: "Europe/Berlin",
    });
    turnFindUniqueMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue(null);

    await expect(
      new SokoBotControlPlane(
        runtimeWithReset(vi.fn()),
        {
          build: vi.fn().mockResolvedValue(builtContext()),
        } as ContextPacketBuilder,
        new ExternalTurnClassifier(false),
      ).startTurn({
        userId: "user_1",
        workspaceId: "workspace_1",
        clientTurnId: "client-turn-bot-asked",
        message: "Any update on the launch?",
        chat: {
          mentionId: "mention_2",
          responseMessageId: "message_2",
          requestedByUserId: "user_other",
          askedByBot: true,
          chainDepth: 1,
        },
      }),
    ).rejects.toThrow(/paused unprompted work/i);

    expect(turnCreateMock).not.toHaveBeenCalled();
  });

  it("grants a bot-asked turn the ability to answer and nothing more", async () => {
    botFindFirstMock.mockResolvedValue(adminBot());
    botFindUniqueMock.mockResolvedValue(adminBot());
    botFindUniqueOrThrowMock.mockResolvedValue({
      userId: "user_1",
      proactivePaused: false,
      proactiveDailyLimit: 20,
      ingestTimezone: "Europe/Berlin",
    });
    turnCountMock.mockResolvedValue(0);
    turnFindUniqueMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue(null);
    turnCreateMock.mockResolvedValue({
      id: "turn_bot_asked",
      leaseToken: "turn_lease",
    });
    const runtime = runtimeWithReset(vi.fn());
    runtime.createSession = vi.fn().mockResolvedValue({
      sessionId: "session_bot_asked",
      runtimeVersion: "eve-test",
      acceptedAt: "2026-08-18T12:00:00.000Z",
    });

    await new SokoBotControlPlane(
      runtime,
      {
        build: vi.fn().mockResolvedValue(builtContext()),
      } as ContextPacketBuilder,
      new ExternalTurnClassifier(false),
    ).startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "client-turn-bot-asked-2",
      message: "Any update on the launch?",
      chat: {
        mentionId: "mention_3",
        responseMessageId: "message_3",
        requestedByUserId: "user_other",
        askedByBot: true,
        chainDepth: 1,
      },
    });

    const data = turnCreateMock.mock.calls[0]?.[0]?.data;
    // Without post_chat it could be summoned but never reply, so a chain
    // could never reach its second hop.
    expect(data?.capabilityNames).toEqual([
      ...SOKO_BOT_BOT_TO_BOT_CAPABILITIES,
    ]);
    expect(data?.chainDepth).toBe(1);
  });

  it("grants the owner their route ceiling and a full packet", async () => {
    botFindFirstMock.mockResolvedValue(adminBot());
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue(null);
    turnCreateMock.mockResolvedValue({
      id: "turn_owner",
      leaseToken: "turn_lease",
    });
    const runtime = runtimeWithReset(vi.fn());
    runtime.createSession = vi.fn().mockResolvedValue({
      sessionId: "session_owner",
      runtimeVersion: "eve-test",
      acceptedAt: "2026-08-18T12:00:00.000Z",
    });
    const contextBuilder = {
      build: vi.fn().mockResolvedValue(builtContext()),
    } as ContextPacketBuilder;

    await new SokoBotControlPlane(
      runtime,
      contextBuilder,
      new ExternalTurnClassifier(false),
    ).startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "client-turn-owner",
      message: "What did Jane email yesterday?",
      chat: {
        mentionId: "mention_1",
        responseMessageId: "message_1",
        requestedByUserId: "user_1",
      },
    });

    const granted = turnCreateMock.mock.calls[0]?.[0]?.data
      ?.capabilityNames as string[];
    expect(granted).toContain("search_inbox");
    expect(contextBuilder.build).toHaveBeenCalledWith(
      expect.objectContaining({ audience: "OWNER" }),
    );
  });

  it("binds a claimed schedule run in the transaction reserving its turn", async () => {
    botFindFirstMock.mockResolvedValue(adminBot());
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue(null);
    turnCreateMock.mockResolvedValue({
      id: "turn_scheduled",
      leaseToken: "turn_lease",
    });
    const runtime = runtimeWithReset(vi.fn());
    const createSession = vi
      .fn<SokoBotRuntime["createSession"]>()
      .mockResolvedValue({
        sessionId: "session_scheduled",
        runtimeVersion: "eve-test",
        acceptedAt: "2026-08-18T12:00:00.000Z",
      });
    runtime.createSession = createSession;
    const contextBuilder = {
      build: vi.fn().mockResolvedValue(builtContext()),
    } as ContextPacketBuilder;

    await new SokoBotControlPlane(
      runtime,
      contextBuilder,
      new ExternalTurnClassifier(false),
    ).startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "schedule:schedule_1:2026-08-18T12:00:00.000Z",
      message: "Review active work",
      source: "SCHEDULE",
      scheduleReservation: {
        runId: "run_1",
        attempt: 2,
        leaseToken: "run_lease_2",
      },
    });

    expect(scheduleRunUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "run_1",
        status: "CLAIMED",
        attempt: 2,
        leaseToken: "run_lease_2",
        prompt: "Review active work",
        schedule: {
          sokoBotId: BOT_ID,
          userId: "user_1",
          workspaceId: "workspace_1",
        },
        OR: [{ turnId: null }, { turnId: "turn_scheduled" }],
      },
      data: { turnId: "turn_scheduled" },
    });
    expect(scheduleRunUpdateManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      createSession.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("does not start Eve when the schedule reservation lease was replaced", async () => {
    botFindFirstMock.mockResolvedValue(adminBot());
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue(null);
    turnCreateMock.mockResolvedValue({ id: "turn_scheduled" });
    scheduleRunUpdateManyMock.mockResolvedValue({ count: 0 });
    const runtime = runtimeWithReset(vi.fn());
    runtime.createSession = vi.fn();
    const contextBuilder = {
      build: vi.fn().mockResolvedValue(builtContext()),
    } as ContextPacketBuilder;

    await expect(
      new SokoBotControlPlane(
        runtime,
        contextBuilder,
        new ExternalTurnClassifier(false),
      ).startTurn({
        userId: "user_1",
        workspaceId: "workspace_1",
        clientTurnId: "schedule:schedule_1:2026-08-18T12:00:00.000Z",
        message: "Review active work",
        source: "SCHEDULE",
        scheduleReservation: {
          runId: "run_1",
          attempt: 2,
          leaseToken: "replaced_lease",
        },
      }),
    ).rejects.toThrow("schedule occurrence lease was replaced");
    expect(runtime.createSession).not.toHaveBeenCalled();
  });

  it("atomically replaces a terminal schedule run link before admin retry runtime start", async () => {
    botFindFirstMock.mockResolvedValue(adminBot());
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue(null);
    turnCreateMock.mockResolvedValue({
      id: "turn_admin_retry",
      leaseToken: "turn_retry_lease",
    });
    const createSession = vi
      .fn<SokoBotRuntime["createSession"]>()
      .mockResolvedValue({
        sessionId: "session_admin_retry",
        runtimeVersion: "eve-test",
        acceptedAt: "2026-08-18T12:00:00.000Z",
      });
    const runtime = runtimeWithReset(vi.fn());
    runtime.createSession = createSession;
    const contextBuilder = {
      build: vi.fn().mockResolvedValue(builtContext()),
    } as ContextPacketBuilder;

    await new SokoBotControlPlane(
      runtime,
      contextBuilder,
      new ExternalTurnClassifier(false),
    ).startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "admin-schedule-retry:run_1:operation_1",
      message: "Original occurrence prompt",
      source: "ADMIN_RETRY",
      adminScheduleReservation: {
        kind: "TERMINAL",
        runId: "run_1",
        expectedStatus: "FAILED",
        expectedAttempt: 2,
        previousTurnId: "turn_original",
        expectedPrompt: "Original occurrence prompt",
      },
    });

    expect(scheduleRunUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "run_1",
        status: "FAILED",
        attempt: 2,
        turnId: "turn_original",
        prompt: "Original occurrence prompt",
        schedule: {
          sokoBotId: BOT_ID,
          userId: "user_1",
          workspaceId: "workspace_1",
        },
      },
      data: {
        status: "RUNNING",
        attempt: { increment: 1 },
        turnId: "turn_admin_retry",
        prompt: "Original occurrence prompt",
        completedAt: null,
        errorKind: null,
        errorDetail: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    expect(scheduleRunUpdateManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      createSession.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("rejects a competing admin retry that loses terminal run CAS before runtime start", async () => {
    botFindFirstMock.mockResolvedValue(adminBot());
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue(null);
    turnCreateMock.mockResolvedValue({ id: "turn_loser" });
    scheduleRunUpdateManyMock.mockResolvedValue({ count: 0 });
    const runtime = runtimeWithReset(vi.fn());
    const contextBuilder = {
      build: vi.fn().mockResolvedValue(builtContext()),
    } as ContextPacketBuilder;

    await expect(
      new SokoBotControlPlane(
        runtime,
        contextBuilder,
        new ExternalTurnClassifier(false),
      ).startTurn({
        userId: "user_1",
        workspaceId: "workspace_1",
        clientTurnId: "admin-schedule-retry:run_1:loser",
        message: "Original occurrence prompt",
        source: "ADMIN_RETRY",
        adminScheduleReservation: {
          kind: "TERMINAL",
          runId: "run_1",
          expectedStatus: "DEAD_LETTER",
          expectedAttempt: 3,
          previousTurnId: "turn_original",
          expectedPrompt: "Original occurrence prompt",
        },
      }),
    ).rejects.toThrow("schedule retry was replaced");

    expect(runtime.createSession).not.toHaveBeenCalled();
  });

  it("accepts an exact bound admin retry replay without reopening a terminal run", async () => {
    const runtime = runtimeWithReset(vi.fn());
    botFindFirstMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockResolvedValue({
      id: "turn_admin_retry",
      sokoBotId: BOT_ID,
      workspaceId: "workspace_1",
      source: "ADMIN_RETRY",
      userMessage: "Original occurrence prompt",
      eveSessionId: "session_admin_retry",
      status: "COMPLETED",
      route: "DIRECT_RESPONSE",
      capabilityNames: [],
      errorKind: null,
      leaseToken: null,
    });
    scheduleRunFindUniqueMock.mockResolvedValue({
      id: "run_1",
      turnId: "turn_admin_retry",
      status: "COMPLETED",
      attempt: 3,
      prompt: "Original occurrence prompt",
      schedule: {
        sokoBotId: BOT_ID,
        userId: "user_1",
        workspaceId: "workspace_1",
      },
    });

    const result = await new SokoBotControlPlane(runtime).startTurn({
      userId: "user_1",
      workspaceId: "workspace_1",
      clientTurnId: "admin-schedule-retry:run_1:operation_1",
      message: "Original occurrence prompt",
      source: "ADMIN_RETRY",
      adminScheduleReservation: {
        kind: "BOUND_REPLAY",
        runId: "run_1",
        boundTurnId: "turn_admin_retry",
        attempt: 3,
      },
    });

    expect(result).toMatchObject({
      turnId: "turn_admin_retry",
      status: "COMPLETED",
      duplicate: true,
    });
    expect(scheduleRunUpdateManyMock).not.toHaveBeenCalled();
    expect(runtime.createSession).not.toHaveBeenCalled();
  });

  it("lease-claims and replays a durable STARTING turn after process loss", async () => {
    const turn = {
      id: "turn_abandoned",
      sokoBotId: BOT_ID,
      userId: "user_1",
      workspaceId: "workspace_1",
      source: "CHAT",
      userMessage: "Delegate the launch brief",
      eveSessionId: null,
      status: "STARTING",
      route: "DELEGATE_TASK",
      capabilityNames: ["create_task"],
      errorKind: null,
      leaseToken: "lease_from_dead_process",
      deadlineAt: new Date("2099-08-18T12:00:00.000Z"),
      sokoBot: adminBot({ status: "RUNNING" }),
    };
    turnFindFirstMock.mockResolvedValue(turn);
    contextSnapshotFindUniqueMock.mockResolvedValue({
      id: "snapshot_1",
      packet: builtContext().packet,
    });
    memoryFindFirstMock.mockResolvedValue(null);
    const runtime = runtimeWithReset(vi.fn());
    runtime.createSession = vi.fn().mockResolvedValue({
      sessionId: "session_recovered",
      runtimeVersion: "eve-test",
      acceptedAt: "2026-08-18T12:00:00.000Z",
    });

    const result = await new SokoBotControlPlane(runtime).recoverStartingTurn(
      turn.id,
    );

    expect(turnUpdateManyMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          id: turn.id,
          status: "STARTING",
          eveSessionId: null,
          leaseToken: "lease_from_dead_process",
        }),
        data: expect.objectContaining({
          leaseToken: expect.not.stringMatching("lease_from_dead_process"),
          errorKind: "runtime_start_ambiguous",
          reconcilerHeartbeatAt: expect.any(Date),
        }),
      }),
    );
    expect(runtime.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: turn.id,
        sessionId: null,
        message: "Delegate the launch brief",
      }),
    );
    expect(result).toMatchObject({
      turnId: turn.id,
      sessionId: "session_recovered",
      status: "RUNNING",
      duplicate: true,
    });
  });

  it("rolls back replay acknowledgement when administrator pause wins", async () => {
    botFindFirstMock.mockResolvedValue(adminBot({ status: "RUNNING" }));
    turnFindUniqueMock.mockResolvedValue({
      id: "turn_existing",
      sokoBotId: BOT_ID,
      userId: "user_1",
      workspaceId: "workspace_1",
      source: "CHAT",
      userMessage: "Hello",
      eveSessionId: null,
      status: "STARTING",
      route: "DIRECT_RESPONSE",
      capabilityNames: [],
      errorKind: "runtime_start_ambiguous",
      leaseToken: "lease_1",
      deadlineAt: new Date("2099-08-18T12:00:00.000Z"),
    });
    contextSnapshotFindUniqueMock.mockResolvedValue({
      id: "snapshot_1",
      packet: builtContext().packet,
    });
    memoryFindFirstMock.mockResolvedValue(null);
    botUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    const resetSession = vi.fn<SokoBotRuntime["resetSession"]>();
    const runtime = runtimeWithReset(resetSession);
    runtime.createSession = vi.fn().mockResolvedValue({
      sessionId: "session_accepted",
      runtimeVersion: "eve-test",
      acceptedAt: "2026-08-18T12:00:00.000Z",
    });

    await expect(
      new SokoBotControlPlane(runtime).startTurn({
        userId: "user_1",
        workspaceId: "workspace_1",
        clientTurnId: "client-turn-1",
        message: "Hello",
      }),
    ).rejects.toThrow("stopped before replay acknowledgement");

    expect(resetSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "session_accepted" }),
    );
  });

  it("sets and clears durable pause only through admin actions", async () => {
    let state = adminBot();
    botFindUniqueMock.mockImplementation(async () => state);
    botUpdateMock.mockImplementation(async ({ data }) => {
      state = { ...state, ...data };
      return state;
    });
    turnFindFirstMock.mockResolvedValue(null);

    await new SokoBotControlPlane().performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "PAUSE",
      reason: "Investigate unexpected activity",
      requestId: "request-pause",
    });

    expect(state.status).toBe("PAUSED");
    expect(state.adminPausedAt).toBeInstanceOf(Date);

    await new SokoBotControlPlane().performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "RESUME",
      reason: "Investigation complete",
      requestId: "request-resume",
    });

    expect(state.status).toBe("IDLE");
    expect(state.adminPausedAt).toBeNull();
  });

  it("linearizes pause state and cancellation intent in one locked transaction", async () => {
    const cancellationRequestedAt = new Date("2026-08-18T10:00:00.000Z");
    let state = adminBot({ status: "RUNNING" });
    botFindUniqueMock.mockImplementation(async () => state);
    botUpdateMock.mockImplementation(async ({ data }) => {
      state = { ...state, ...data };
      return state;
    });
    turnFindFirstMock.mockResolvedValue({
      id: "turn_1",
      status: "RUNNING",
      eveSessionId: "session_1",
      eveTurnId: "eve_turn_1",
      cancellationRequestedAt,
      userId: "user_1",
      sokoBotId: BOT_ID,
      workspaceId: "workspace_1",
    });
    const cancelTurn = vi.fn<SokoBotRuntime["cancelTurn"]>();
    const runtime = runtimeWithReset(vi.fn());
    runtime.cancelTurn = cancelTurn;

    await new SokoBotControlPlane(runtime).performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "PAUSE",
      reason: "Stop work",
      operationId: "pause-operation-1",
    });

    expect(transactionQueryRawMock).toHaveBeenCalledOnce();
    expect(turnFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ sokoBotId: BOT_ID }),
      }),
    );
    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "turn_1" }),
        data: expect.objectContaining({ status: "CANCEL_REQUESTED" }),
      }),
    );
    expect(state).toMatchObject({ status: "PAUSED" });
    expect(state.adminPausedAt).toBeInstanceOf(Date);
    expect(cancelTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session_1",
        eveTurnId: "eve_turn_1",
      }),
    );
  });

  it("retries delivery for an already requested cancellation", async () => {
    turnFindFirstMock.mockResolvedValue({
      id: "turn_1",
      status: "CANCEL_REQUESTED",
      eveSessionId: "session_1",
      eveTurnId: "eve_turn_1",
      userId: "user_1",
      sokoBotId: BOT_ID,
      workspaceId: "workspace_1",
    });
    turnUpdateManyMock.mockResolvedValue({ count: 0 });
    const cancelTurn = vi.fn<SokoBotRuntime["cancelTurn"]>();
    const runtime = runtimeWithReset(vi.fn());
    runtime.cancelTurn = cancelTurn;

    await new SokoBotControlPlane(runtime).cancelTurn("user_1", "turn_1");

    expect(cancelTurn).toHaveBeenCalledWith(
      expect.objectContaining({ eveTurnId: "eve_turn_1" }),
    );
  });

  it("never sends a session-wide cancellation before Eve turn binding", async () => {
    turnFindFirstMock.mockResolvedValue({
      id: "turn_1",
      status: "RUNNING",
      eveSessionId: "session_1",
      eveTurnId: null,
      userId: "user_1",
      sokoBotId: BOT_ID,
      workspaceId: "workspace_1",
    });
    const cancelTurn = vi.fn<SokoBotRuntime["cancelTurn"]>();
    const runtime = runtimeWithReset(vi.fn());
    runtime.cancelTurn = cancelTurn;

    await new SokoBotControlPlane(runtime).cancelTurn("user_1", "turn_1");

    expect(cancelTurn).not.toHaveBeenCalled();
  });

  it("archives behind the bot lock and requests cancellation of active work", async () => {
    botFindFirstMock.mockResolvedValue(adminBot({ eveSessionId: "session_1" }));
    turnFindFirstMock.mockResolvedValue({
      id: "turn_1",
      userId: "user_1",
      sokoBotId: BOT_ID,
      workspaceId: "workspace_1",
      eveSessionId: "session_1",
      eveTurnId: "eve_turn_1",
      status: "RUNNING",
    });
    botUpdateMock.mockResolvedValue({});
    const cancelTurn = vi.fn<SokoBotRuntime["cancelTurn"]>();
    const runtime = runtimeWithReset(vi.fn());
    runtime.cancelTurn = cancelTurn;

    await new SokoBotControlPlane(runtime).archive("user_1", "ws_1");

    expect(transactionQueryRawMock).toHaveBeenCalledOnce();
    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CANCEL_REQUESTED" }),
      }),
    );
    expect(botUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PAUSED",
          eveSessionId: null,
        }),
      }),
    );
    expect(cancelTurn).toHaveBeenCalledWith(
      expect.objectContaining({ eveTurnId: "eve_turn_1" }),
    );
  });

  it("does not let an administrator resume an owner-archived bot", async () => {
    botFindUniqueMock.mockResolvedValue({
      id: BOT_ID,
      userId: "user_1",
      archivedAt: new Date(),
      adminPausedAt: null,
      status: "PAUSED",
      eveSessionId: null,
      memoryVersion: 1,
    });

    await expect(
      new SokoBotControlPlane().performAdminAction({
        sokoBotId: BOT_ID,
        operatorId: "admin_1",
        action: "RESUME",
        reason: "Resume requested by support",
      }),
    ).rejects.toThrow("Archived Soko Bot cannot be resumed");

    expect(botUpdateMock).not.toHaveBeenCalled();
    expect(adminActionCreateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({ status: "ATTEMPTED" }),
      }),
    );
    expect(adminActionCreateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorKind: "validation",
        }),
      }),
    );
  });

  it("rolls back a local mutation when its success audit cannot commit", async () => {
    let state = adminBot({ status: "PAUSED" });
    const auditEvents: Array<Record<string, unknown>> = [];
    botFindUniqueMock.mockImplementation(async () => state);
    botUpdateMock.mockImplementation(async ({ data }) => {
      state = { ...state, ...data };
      return state;
    });
    adminActionCreateMock.mockImplementation(async ({ data }) => {
      if (data.status === "SUCCEEDED") throw new Error("audit unavailable");
      auditEvents.push(data);
      return data;
    });
    transactionMock.mockImplementation(
      async (
        callback: (tx: ReturnType<typeof transactionClient>) => unknown,
      ) => {
        const snapshot = { ...state };
        try {
          return await callback(transactionClient());
        } catch (error) {
          state = snapshot;
          throw error;
        }
      },
    );

    await expect(
      new SokoBotControlPlane().performAdminAction({
        sokoBotId: BOT_ID,
        operatorId: "admin_1",
        action: "RESUME",
        reason: "Restore service",
        requestId: "request-local-rollback",
      }),
    ).rejects.toThrow("audit unavailable");

    expect(state.status).toBe("PAUSED");
    expect(auditEvents.map((event) => event.status)).toEqual([
      "ATTEMPTED",
      "FAILED",
    ]);
  });

  it("leaves reset intent resumable and bot fenced when Eve reset is uncertain", async () => {
    const auditEvents: Array<Record<string, unknown>> = [];
    const resetSession = vi
      .fn<SokoBotRuntime["resetSession"]>()
      .mockRejectedValue(new Error("secret runtime credential"));
    botFindUniqueMock.mockResolvedValue(
      adminBot({ status: "RUNNING", eveSessionId: "eve-session-secret" }),
    );
    turnFindFirstMock.mockResolvedValue({
      id: "turn_1",
      status: "RUNNING",
      workspaceId: "workspace_1",
      eveSessionId: "eve-session-secret",
      leaseToken: "turn-lease-1",
    });
    turnFindUniqueMock.mockImplementation(async () => ({
      sokoBotId: BOT_ID,
      userId: "user_1",
      eveSessionId: "eve-session-secret",
      startedAt: new Date("2026-08-18T12:00:00.000Z"),
      costUsdMicros: 0n,
      status: "CANCEL_REQUESTED",
      leaseToken: turnUpdateManyMock.mock.calls[0]?.[0]?.data?.leaseToken,
      cancellationRequestedAt: new Date("2026-08-18T12:01:00.000Z"),
      scheduleRun: null,
    }));
    adminActionCreateMock.mockImplementation(async ({ data }) => {
      auditEvents.push(data);
      return data;
    });

    await expect(
      new SokoBotControlPlane(
        runtimeWithReset(resetSession),
      ).performAdminAction({
        sokoBotId: BOT_ID,
        operatorId: "admin_1",
        action: "RESET_SESSION",
        reason: "Clear broken runtime session",
        requestId: "request-remote-failure",
        traceId: "11111111111111111111111111111111",
      }),
    ).rejects.toThrow("secret runtime credential");

    expect(auditEvents.map((event) => event.status)).toEqual(["ATTEMPTED"]);
    expect(JSON.stringify(auditEvents)).not.toContain("eve-session-secret");
    expect(JSON.stringify(auditEvents)).not.toContain(
      "secret runtime credential",
    );
    expect(botUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "PAUSED", eveSessionId: null },
      }),
    );
  });

  it("appends success after Eve reset and commits local state with outcome", async () => {
    const auditEvents: Array<Record<string, unknown>> = [];
    const resetSession = vi.fn<SokoBotRuntime["resetSession"]>();
    const initial = adminBot({
      status: "RUNNING",
      eveSessionId: "eve-session-secret",
    });
    let state = initial;
    botFindUniqueMock.mockImplementation(async () => state);
    botUpdateMock.mockImplementation(async ({ data }) => {
      state = { ...state, ...data };
      return state;
    });
    turnFindFirstMock.mockResolvedValue({
      id: "turn_1",
      status: "RUNNING",
      workspaceId: "workspace_1",
      eveSessionId: "eve-session-secret",
      leaseToken: "turn-lease-1",
    });
    turnFindUniqueMock.mockImplementation(async () => ({
      sokoBotId: BOT_ID,
      userId: "user_1",
      eveSessionId: "eve-session-secret",
      startedAt: new Date("2026-08-18T12:00:00.000Z"),
      costUsdMicros: 0n,
      status: "CANCEL_REQUESTED",
      leaseToken: turnUpdateManyMock.mock.calls[0]?.[0]?.data?.leaseToken,
      cancellationRequestedAt: new Date("2026-08-18T12:01:00.000Z"),
      scheduleRun: {
        id: "schedule_run_1",
        scheduleId: "schedule_1",
        status: "RUNNING",
        attempt: 2,
        leaseToken: "schedule-lease-2",
      },
    }));
    adminActionCreateMock.mockImplementation(async ({ data }) => {
      auditEvents.push(data);
      return data;
    });

    await new SokoBotControlPlane(
      runtimeWithReset(resetSession),
    ).performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "RESET_SESSION",
      reason: "Clear completed session",
      requestId: "request-remote-success",
    });

    expect(auditEvents.map((event) => event.status)).toEqual([
      "ATTEMPTED",
      "SUCCEEDED",
    ]);
    expect(resetSession).toHaveBeenCalledOnce();
    expect(botUpdateMock.mock.invocationCallOrder[0]).toBeLessThan(
      resetSession.mock.invocationCallOrder[0] ?? 0,
    );
    expect(resetSession.mock.invocationCallOrder[0]).toBeLessThan(
      adminActionCreateMock.mock.invocationCallOrder[1] ?? 0,
    );
    expect(transactionMock).toHaveBeenCalledTimes(3);
    expect(recordUsageMock).toHaveBeenCalledOnce();
    const resetLeaseToken =
      turnUpdateManyMock.mock.calls[0]?.[0]?.data?.leaseToken;
    expect(resetLeaseToken).toEqual(expect.any(String));
    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "turn_1",
          leaseToken: resetLeaseToken,
        }),
        data: expect.objectContaining({
          status: "CANCELLED",
          leaseToken: null,
          leaseExpiresAt: null,
        }),
      }),
    );
    expect(scheduleRunUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: "schedule_run_1",
        status: "RUNNING",
        attempt: 2,
        leaseToken: "schedule-lease-2",
      },
      data: expect.objectContaining({
        status: "FAILED",
        errorKind: "session_reset",
      }),
    });
    expect(scheduleUpdateMock).toHaveBeenCalledWith({
      where: { id: "schedule_1" },
      data: { consecutiveFailures: { increment: 1 } },
    });
    expect(JSON.stringify(auditEvents)).not.toContain("eve-session-secret");
  });

  it("does not reset a stale session target when concurrent start attached another", async () => {
    const original = adminBot({
      status: "IDLE",
      eveSessionId: "session_old",
    });
    const concurrent = adminBot({
      status: "RUNNING",
      eveSessionId: "session_new",
    });
    botFindUniqueMock
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(concurrent)
      .mockResolvedValue(concurrent);
    turnFindFirstMock
      .mockResolvedValueOnce({ id: "turn_old" })
      .mockResolvedValueOnce({
        id: "turn_new",
        status: "RUNNING",
        eveSessionId: "session_new",
      })
      .mockResolvedValueOnce({
        id: "turn_old",
        workspaceId: "workspace_1",
        eveSessionId: "session_old",
      });
    const resetSession = vi.fn<SokoBotRuntime["resetSession"]>();

    await expect(
      new SokoBotControlPlane(
        runtimeWithReset(resetSession),
      ).performAdminAction({
        sokoBotId: BOT_ID,
        operatorId: "admin_1",
        action: "RESET_SESSION",
        reason: "Reset captured session",
        operationId: "stale-session-reset",
      }),
    ).rejects.toThrow("Runtime session changed");

    expect(resetSession).not.toHaveBeenCalled();
    expect(botUpdateMock).not.toHaveBeenCalled();
  });

  it("prefers a caller operation id for resumable admin intent", async () => {
    botFindUniqueMock.mockResolvedValue(adminBot({ status: "PAUSED" }));
    botUpdateMock.mockResolvedValue(adminBot({ status: "IDLE" }));

    await new SokoBotControlPlane().performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "RESUME",
      reason: "Resume",
      operationId: "admin-operation-123",
      requestId: "request-transport-1",
    });

    expect(adminActionCreateMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          operationId: "admin-operation-123",
          status: "ATTEMPTED",
        }),
      }),
    );
  });

  it("refuses resume while a session-reset outbox entry is unfinished", async () => {
    botFindUniqueMock.mockResolvedValue(adminBot({ status: "PAUSED" }));
    adminActionFindManyMock
      .mockResolvedValueOnce([{ operationId: "reset-operation" }])
      .mockResolvedValueOnce([]);

    await expect(
      new SokoBotControlPlane().performAdminAction({
        sokoBotId: BOT_ID,
        operatorId: "admin_1",
        action: "RESUME",
        reason: "Resume too early",
        operationId: "resume-operation",
      }),
    ).rejects.toThrow("session reset is still in progress");

    expect(botUpdateMock).not.toHaveBeenCalled();
  });

  it("resets schedule failure history when an owner re-enables it", async () => {
    const now = new Date("2026-08-18T12:34:56.000Z");
    vi.setSystemTime(now);
    scheduleFindFirstMock.mockResolvedValue({
      id: "schedule_1",
      sokoBotId: BOT_ID,
      userId: "user_1",
      enabled: false,
      consecutiveFailures: 5,
      timezone: "UTC",
      cronExpression: "0 * * * * *",
      nextRunAt: new Date("2026-08-17T12:00:00.000Z"),
    });
    scheduleUpdateMock.mockResolvedValue({ id: "schedule_1", enabled: true });

    await new SokoBotControlPlane().updateSchedule({
      userId: "user_1",
      scheduleId: "schedule_1",
      enabled: true,
    });

    expect(scheduleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          enabled: true,
          consecutiveFailures: 0,
          nextRunAt: expect.any(Date),
        }),
      }),
    );
    const nextRunAt = scheduleUpdateMock.mock.calls[0]?.[0]?.data?.nextRunAt;
    expect(nextRunAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it("recursively redacts sensitive admin presentation fields", async () => {
    botFindUniqueMock.mockResolvedValue(
      adminBot({
        name: "Soko",
        memoryHash: "hash",
        turns: [
          {
            id: "turn_1",
            userMessage: "password=turn-secret",
            finalAnswer: "token=answer-secret",
            events: [],
            toolCalls: [{ result: { nested: "api_key=tool-secret" } }],
            pendingDecisions: [
              {
                proposal: {
                  nested: "secret=proposal-secret",
                  inputData: { password: "hunter2" },
                },
              },
            ],
          },
        ],
        memoryRevisions: [],
        legacyMessages: [{ content: "password=legacy-secret" }],
        pendingDecisions: [],
        schedules: [{ prompt: "token=schedule-secret", runs: [] }],
      }),
    );

    const detail = await new SokoBotControlPlane().getForAdmin(BOT_ID);
    const serialized = JSON.stringify(detail);

    for (const secret of [
      "turn-secret",
      "answer-secret",
      "tool-secret",
      "proposal-secret",
      "hunter2",
      "legacy-secret",
      "schedule-secret",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("deduplicates an admin action by request ID without repeating effects", async () => {
    const existingIntent = {
      sokoBotId: BOT_ID,
      userId: "user_1",
      operatorId: "admin_1",
      action: "RESET_SESSION",
      reason: "Retry same request",
    };
    botFindUniqueMock
      .mockResolvedValueOnce(adminBot())
      .mockResolvedValueOnce(adminBot());
    adminActionCreateMock.mockRejectedValue({ code: "P2002" });
    adminActionFindUniqueMock.mockResolvedValue(existingIntent);
    adminActionFindFirstMock.mockResolvedValue({ status: "SUCCEEDED" });
    adminActionFindManyMock.mockResolvedValue([
      { ...existingIntent, status: "ATTEMPTED" },
    ]);
    const resetSession = vi.fn<SokoBotRuntime["resetSession"]>();

    const detail = await new SokoBotControlPlane(
      runtimeWithReset(resetSession),
    ).performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "RESET_SESSION",
      reason: "Retry same request",
      requestId: "request-duplicate",
    });

    expect(detail.adminActions).toHaveLength(1);
    expect(adminActionFindUniqueMock).toHaveBeenCalledWith({
      where: {
        operationId_status: {
          operationId: expect.any(String),
          status: "ATTEMPTED",
        },
      },
    });
    expect(resetSession).not.toHaveBeenCalled();
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("resumes an orphaned admin intent and appends its terminal outcome", async () => {
    const existingIntent = {
      sokoBotId: BOT_ID,
      userId: "user_1",
      operatorId: "admin_1",
      action: "RESET_SESSION",
      targetId: null,
      reason: "Resume interrupted reset",
    };
    let state = adminBot({ status: "RUNNING", eveSessionId: null });
    botFindUniqueMock.mockImplementation(async () => state);
    botUpdateMock.mockImplementation(async ({ data }) => {
      state = { ...state, ...data };
      return state;
    });
    adminActionCreateMock.mockResolvedValue({});
    adminActionFindUniqueMock.mockResolvedValue(existingIntent);
    adminActionFindFirstMock.mockResolvedValue(null);
    adminActionFindManyMock.mockResolvedValue([
      { ...existingIntent, status: "SUCCEEDED" },
    ]);
    turnFindFirstMock.mockResolvedValue(null);

    const detail = await new SokoBotControlPlane().performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "RESET_SESSION",
      reason: "Resume interrupted reset",
      requestId: "request-orphaned-intent",
    });

    expect(detail.adminActions).toHaveLength(1);
    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(adminActionCreateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
  });

  it("binds retry-last operation replay to its originally resolved failed turn", async () => {
    const failedTurnId = "01960001-0001-7001-8001-000000000099";
    const existingIntent = {
      sokoBotId: BOT_ID,
      userId: "user_1",
      operatorId: "admin_1",
      action: "RETRY_LAST_FAILED",
      targetId: failedTurnId,
      reason: "Retry stable target",
    };
    const bot = adminBot({ status: "RUNNING" });
    botFindUniqueMock.mockResolvedValue(bot);
    botFindUniqueOrThrowMock.mockResolvedValue(bot);
    botFindFirstMock.mockResolvedValue(bot);
    adminActionFindUniqueMock.mockResolvedValue(existingIntent);
    adminActionFindFirstMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue({
      id: failedTurnId,
      workspaceId: "workspace_1",
      userMessage: "Original failed request",
    });
    turnFindUniqueMock.mockResolvedValue({
      id: "retry_turn",
      sokoBotId: BOT_ID,
      workspaceId: "workspace_1",
      source: "ADMIN_RETRY",
      userMessage: "Original failed request",
      eveSessionId: "retry_session",
      status: "RUNNING",
      route: "DIRECT_RESPONSE",
      capabilityNames: [],
      errorKind: null,
      leaseToken: "retry_lease",
    });

    await new SokoBotControlPlane().performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "RETRY_LAST_FAILED",
      reason: "Retry stable target",
      operationId: "retry-operation",
    });

    expect(turnFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: failedTurnId,
        sokoBotId: BOT_ID,
        status: "FAILED",
      },
    });
    expect(turnFindUniqueMock).toHaveBeenCalledWith({
      where: {
        sokoBotId_clientTurnId: {
          sokoBotId: BOT_ID,
          clientTurnId: `admin-retry:${failedTurnId}:${adminRetryOperationKey("retry-operation")}`,
        },
      },
    });
    expect(adminActionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          operationId: "retry-operation",
          status: "SUCCEEDED",
          targetId: failedTurnId,
        }),
      }),
    );
  });

  it("derives distinct retry-last turn IDs from full operation IDs sharing a prefix", async () => {
    const sharedPrefix = "x".repeat(32);
    const operationIds = [`${sharedPrefix}-one`, `${sharedPrefix}-two`];
    const failedTurnId = "01960001-0001-7001-8001-000000000099";
    const controlPlane = new SokoBotControlPlane();
    const startTurn = vi
      .spyOn(controlPlane, "startTurn")
      .mockImplementation(async ({ clientTurnId }) => ({
        turnId: `turn_${clientTurnId}`,
        sokoBotId: BOT_ID,
        sessionId: "session_retry",
        status: "RUNNING",
        route: "DIRECT_RESPONSE",
        capabilities: [],
        duplicate: false,
      }));
    const bot = adminBot();
    botFindUniqueMock.mockResolvedValue(bot);
    botFindUniqueOrThrowMock.mockResolvedValue(bot);
    adminActionFindUniqueMock.mockResolvedValue(null);
    adminActionFindFirstMock.mockResolvedValue(null);
    turnFindFirstMock.mockResolvedValue({
      id: failedTurnId,
      workspaceId: "workspace_1",
      userMessage: "Original failed request",
    });

    for (const operationId of operationIds) {
      await controlPlane.performAdminAction({
        sokoBotId: BOT_ID,
        operatorId: "admin_1",
        action: "RETRY_LAST_FAILED",
        targetId: failedTurnId,
        reason: "Retry stable target",
        operationId,
      });
    }

    const clientTurnIds = startTurn.mock.calls.map(
      ([input]) => input.clientTurnId,
    );
    expect(clientTurnIds).toHaveLength(2);
    expect(clientTurnIds[0]).not.toBe(clientTurnIds[1]);
    expect(clientTurnIds.every((value) => value.length <= 120)).toBe(true);
    const retryTurnIds = adminActionCreateMock.mock.calls
      .map(([argument]) => argument.data)
      .filter(({ status }) => status === "SUCCEEDED")
      .map(({ after }) => after.retryTurnId);
    expect(retryTurnIds).toHaveLength(2);
    expect(retryTurnIds[0]).not.toBe(retryTurnIds[1]);
  });

  it.each(["RETRY_LAST_FAILED", "RETRY_SCHEDULE_RUN"] as const)(
    "blocks %s while Soko Bot kill switch is disabled",
    async (action) => {
      getEnvMock.mockReturnValue({
        SOKO_BOT_CLASSIFIER_MODE: "rules",
        SOKO_BOT_ENABLED: false,
      });
      botFindUniqueMock.mockResolvedValue(adminBot());
      adminActionFindUniqueMock.mockResolvedValue(null);
      adminActionFindFirstMock.mockResolvedValue(null);

      await expect(
        new SokoBotControlPlane().performAdminAction({
          sokoBotId: BOT_ID,
          operatorId: "admin_1",
          action,
          targetId: "01960001-0001-7001-8001-000000000099",
          reason: "Retry after operator review",
          operationId: `disabled-${action.toLowerCase()}`,
        }),
      ).rejects.toThrow("Soko Bot is disabled");

      expect(turnCreateMock).not.toHaveBeenCalled();
      expect(
        adminActionCreateMock.mock.calls.map(
          ([argument]) => argument.data.status,
        ),
      ).toEqual(["ATTEMPTED", "FAILED"]);
    },
  );

  it("uses immutable occurrence prompt and avoids post-start schedule-run mutation for admin retry", async () => {
    const controlPlane = new SokoBotControlPlane();
    const startTurn = vi.spyOn(controlPlane, "startTurn").mockResolvedValue({
      turnId: "turn_admin_retry",
      sokoBotId: BOT_ID,
      sessionId: "session_admin_retry",
      status: "RUNNING",
      route: "DIRECT_RESPONSE",
      capabilities: [],
      duplicate: false,
    });
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockResolvedValue(null);
    scheduleRunFindFirstMock.mockResolvedValue({
      id: "run_1",
      status: "FAILED",
      attempt: 2,
      turnId: "turn_original",
      prompt: "Original occurrence prompt",
      schedule: {
        sokoBotId: BOT_ID,
        userId: "user_1",
        workspaceId: "workspace_1",
        prompt: "Edited future prompt",
      },
      turn: {
        id: "turn_original",
        source: "SCHEDULE",
        clientTurnId: "schedule:schedule_1:original",
        status: "FAILED",
      },
    });

    await controlPlane.performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "RETRY_SCHEDULE_RUN",
      targetId: "run_1",
      reason: "Retry original occurrence",
      operationId: "operation_1",
    });

    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Original occurrence prompt",
        source: "ADMIN_RETRY",
        adminScheduleReservation: {
          kind: "TERMINAL",
          runId: "run_1",
          expectedStatus: "FAILED",
          expectedAttempt: 2,
          previousTurnId: "turn_original",
          expectedPrompt: "Original occurrence prompt",
        },
      }),
    );
    expect(scheduleRunUpdateMock).not.toHaveBeenCalled();
  });

  it("resumes the same admin operation after its retry turn was atomically bound", async () => {
    const operationId = "operation_replay";
    const clientTurnId = `admin-schedule-retry:run_1:${adminRetryOperationKey(operationId)}`;
    const existingIntent = {
      sokoBotId: BOT_ID,
      userId: "user_1",
      operatorId: "admin_1",
      action: "RETRY_SCHEDULE_RUN",
      targetId: "run_1",
      reason: "Resume retry",
    };
    const controlPlane = new SokoBotControlPlane();
    const startTurn = vi.spyOn(controlPlane, "startTurn").mockResolvedValue({
      turnId: "turn_admin_retry",
      sokoBotId: BOT_ID,
      sessionId: "session_admin_retry",
      status: "COMPLETED",
      route: "DIRECT_RESPONSE",
      capabilities: [],
      duplicate: true,
    });
    botFindUniqueMock.mockResolvedValue(adminBot());
    adminActionFindUniqueMock.mockResolvedValue(existingIntent);
    adminActionFindFirstMock.mockResolvedValue(null);
    turnFindUniqueMock.mockResolvedValue({ id: "turn_admin_retry" });
    scheduleRunFindFirstMock.mockResolvedValue({
      id: "run_1",
      status: "COMPLETED",
      attempt: 3,
      turnId: "turn_admin_retry",
      prompt: "Original occurrence prompt",
      schedule: {
        sokoBotId: BOT_ID,
        userId: "user_1",
        workspaceId: "workspace_1",
        prompt: "Edited future prompt",
      },
      turn: {
        id: "turn_admin_retry",
        source: "ADMIN_RETRY",
        clientTurnId,
        status: "COMPLETED",
      },
    });

    await controlPlane.performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "RETRY_SCHEDULE_RUN",
      targetId: "run_1",
      reason: "Resume retry",
      operationId,
    });

    expect(scheduleRunFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "run_1",
          schedule: { sokoBotId: BOT_ID },
        },
      }),
    );
    expect(startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        clientTurnId,
        message: "Original occurrence prompt",
        adminScheduleReservation: {
          kind: "BOUND_REPLAY",
          runId: "run_1",
          boundTurnId: "turn_admin_retry",
          attempt: 3,
        },
      }),
    );
    expect(scheduleRunUpdateMock).not.toHaveBeenCalled();
  });

  it("fails stale retry replay after a later operation replaced its bound turn", async () => {
    const operationId = "operation_a";
    const existingIntent = {
      sokoBotId: BOT_ID,
      userId: "user_1",
      operatorId: "admin_1",
      action: "RETRY_SCHEDULE_RUN",
      targetId: "run_1",
      reason: "Resume retry A",
    };
    const controlPlane = new SokoBotControlPlane();
    const startTurn = vi.spyOn(controlPlane, "startTurn").mockResolvedValue({
      turnId: "turn_retry_a",
      sokoBotId: BOT_ID,
      sessionId: "session_retry_a",
      status: "FAILED",
      route: "DIRECT_RESPONSE",
      capabilities: [],
      duplicate: true,
    });
    botFindUniqueMock.mockResolvedValue(adminBot());
    adminActionFindUniqueMock.mockResolvedValue(existingIntent);
    adminActionFindFirstMock.mockResolvedValue(null);
    turnFindUniqueMock.mockResolvedValue({ id: "turn_retry_a" });
    scheduleRunFindFirstMock.mockResolvedValue({
      id: "run_1",
      status: "FAILED",
      attempt: 4,
      turnId: "turn_retry_b",
      prompt: "Original occurrence prompt",
      schedule: {
        sokoBotId: BOT_ID,
        userId: "user_1",
        workspaceId: "workspace_1",
        prompt: "Edited future prompt",
      },
      turn: {
        id: "turn_retry_b",
        source: "ADMIN_RETRY",
        clientTurnId: "admin-schedule-retry:run_1:operation_b",
        status: "FAILED",
      },
    });

    await expect(
      controlPlane.performAdminAction({
        sokoBotId: BOT_ID,
        operatorId: "admin_1",
        action: "RETRY_SCHEDULE_RUN",
        targetId: "run_1",
        reason: "Resume retry A",
        operationId,
      }),
    ).rejects.toThrow("superseded by a later retry");

    expect(startTurn).not.toHaveBeenCalled();
    expect(scheduleRunUpdateManyMock).not.toHaveBeenCalled();
    expect(adminActionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          operationId,
          status: "FAILED",
        }),
      }),
    );
  });

  it("replays an admin retry after crashing between atomic turn binding and success audit", async () => {
    const operationId = "operation_crash_window";
    const clientTurnId = `admin-schedule-retry:run_1:${adminRetryOperationKey(operationId)}`;
    const existingIntent = {
      sokoBotId: BOT_ID,
      userId: "user_1",
      operatorId: "admin_1",
      action: "RETRY_SCHEDULE_RUN",
      targetId: "run_1",
      reason: "Retry after crash",
    };
    let scheduleRun = {
      id: "run_1",
      status: "FAILED",
      attempt: 2,
      turnId: "turn_original",
      prompt: "Original occurrence prompt",
      schedule: {
        sokoBotId: BOT_ID,
        userId: "user_1",
        workspaceId: "workspace_1",
        prompt: "Edited future prompt",
      },
      turn: {
        id: "turn_original",
        source: "SCHEDULE",
        clientTurnId: "schedule:schedule_1:original",
        status: "FAILED",
      },
    };
    let durableRetryTurn: { id: string } | null = null;
    scheduleRunFindFirstMock.mockImplementation(async () => scheduleRun);
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockImplementation(async () => durableRetryTurn);
    adminActionFindUniqueMock.mockResolvedValue(null);
    adminActionFindFirstMock.mockResolvedValue(null);
    const controlPlane = new SokoBotControlPlane();
    const startTurn = vi
      .spyOn(controlPlane, "startTurn")
      .mockImplementationOnce(async () => {
        durableRetryTurn = { id: "turn_admin_retry" };
        scheduleRun = {
          ...scheduleRun,
          status: "RUNNING",
          attempt: 3,
          turnId: "turn_admin_retry",
          turn: {
            id: "turn_admin_retry",
            source: "ADMIN_RETRY",
            clientTurnId,
            status: "RUNNING",
          },
        };
        return {
          turnId: "turn_admin_retry",
          sokoBotId: BOT_ID,
          sessionId: "session_admin_retry",
          status: "RUNNING",
          route: "DIRECT_RESPONSE",
          capabilities: [],
          duplicate: false,
        };
      })
      .mockResolvedValueOnce({
        turnId: "turn_admin_retry",
        sokoBotId: BOT_ID,
        sessionId: "session_admin_retry",
        status: "RUNNING",
        route: "DIRECT_RESPONSE",
        capabilities: [],
        duplicate: true,
      });
    let successAuditAttempts = 0;
    adminActionCreateMock.mockImplementation(async ({ data }) => {
      if (data.status === "SUCCEEDED" && successAuditAttempts++ === 0) {
        throw new Error("process crashed before success audit commit");
      }
      return data;
    });

    const actionInput = {
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "RETRY_SCHEDULE_RUN" as const,
      targetId: "run_1",
      reason: "Retry after crash",
      operationId,
    };
    await expect(controlPlane.performAdminAction(actionInput)).rejects.toThrow(
      "process crashed before success audit commit",
    );

    adminActionFindUniqueMock.mockResolvedValue(existingIntent);
    adminActionFindFirstMock.mockResolvedValue(null);
    await controlPlane.performAdminAction(actionInput);

    expect(startTurn).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        clientTurnId,
        adminScheduleReservation: expect.objectContaining({
          kind: "TERMINAL",
          previousTurnId: "turn_original",
        }),
      }),
    );
    expect(startTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        clientTurnId,
        adminScheduleReservation: {
          kind: "BOUND_REPLAY",
          runId: "run_1",
          boundTurnId: "turn_admin_retry",
          attempt: 3,
        },
      }),
    );
    expect(
      adminActionCreateMock.mock.calls.filter(
        ([argument]) => argument.data.status === "FAILED",
      ),
    ).toHaveLength(0);
    expect(scheduleRunUpdateMock).not.toHaveBeenCalled();
  });

  it("records a deterministic admin retry failure when no retry turn was reserved", async () => {
    const controlPlane = new SokoBotControlPlane();
    vi.spyOn(controlPlane, "startTurn").mockRejectedValue(
      new Error("insufficient credits before reservation"),
    );
    botFindUniqueMock.mockResolvedValue(adminBot());
    turnFindUniqueMock.mockResolvedValue(null);
    adminActionFindUniqueMock.mockResolvedValue(null);
    adminActionFindFirstMock.mockResolvedValue(null);
    scheduleRunFindFirstMock.mockResolvedValue({
      id: "run_1",
      status: "FAILED",
      attempt: 2,
      turnId: "turn_original",
      prompt: "Original occurrence prompt",
      schedule: {
        sokoBotId: BOT_ID,
        userId: "user_1",
        workspaceId: "workspace_1",
        prompt: "Edited future prompt",
      },
      turn: {
        id: "turn_original",
        source: "SCHEDULE",
        clientTurnId: "schedule:schedule_1:original",
        status: "FAILED",
      },
    });

    await expect(
      controlPlane.performAdminAction({
        sokoBotId: BOT_ID,
        operatorId: "admin_1",
        action: "RETRY_SCHEDULE_RUN",
        targetId: "run_1",
        reason: "Retry after funding",
        operationId: "operation_prefailure",
      }),
    ).rejects.toThrow("insufficient credits before reservation");

    expect(
      adminActionCreateMock.mock.calls.map(
        ([argument]) => argument.data.status,
      ),
    ).toEqual(["ATTEMPTED", "FAILED"]);
  });

  it("settles an expired turn and its linked schedule run once", async () => {
    turnFindFirstMock.mockResolvedValue({
      id: "turn_1",
      userId: "user_1",
      sokoBotId: BOT_ID,
      workspaceId: "01960001-0001-7001-8001-000000000004",
      eveSessionId: null,
      eveTurnId: null,
    });
    turnFindUniqueMock.mockResolvedValue({
      sokoBotId: BOT_ID,
      userId: "user_1",
      eveSessionId: "session_1",
      startedAt: new Date(Date.now() - 5_000),
      costUsdMicros: 0n,
      status: "RUNNING",
      leaseToken: "lease_1",
      scheduleRun: {
        id: "01960001-0001-7001-8001-000000000002",
        scheduleId: "01960001-0001-7001-8001-000000000003",
        status: "RUNNING",
        attempt: 2,
        leaseToken: "run_lease_2",
      },
    });
    turnUpdateManyMock.mockResolvedValue({ count: 1 });
    botUpdateManyMock.mockResolvedValue({ count: 1 });
    scheduleRunUpdateManyMock.mockResolvedValue({ count: 1 });
    scheduleUpdateMock.mockResolvedValue({});

    const settled = await new SokoBotControlPlane().expireTurn("turn_1");

    expect(settled).toBe(true);
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorKind: "turn_deadline_exceeded",
          leaseToken: null,
          leaseExpiresAt: null,
        }),
      }),
    );
    expect(scheduleRunUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "01960001-0001-7001-8001-000000000002",
          status: "RUNNING",
          attempt: 2,
          leaseToken: "run_lease_2",
        },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(scheduleUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { consecutiveFailures: { increment: 1 } },
      }),
    );
  });

  it("settles a no-session cancellation only under its current lease", async () => {
    turnFindFirstMock.mockResolvedValue({ leaseToken: "cancel-lease-1" });
    turnFindUniqueMock.mockResolvedValue({
      sokoBotId: BOT_ID,
      userId: "user_1",
      eveSessionId: null,
      startedAt: null,
      costUsdMicros: 0n,
      status: "CANCEL_REQUESTED",
      leaseToken: "cancel-lease-1",
      cancellationRequestedAt: new Date(),
      scheduleRun: null,
    });

    const settled =
      await new SokoBotControlPlane().settleUndeliverableCancellation(
        "turn_cancelled_before_acceptance",
      );

    expect(settled).toBe(true);
    expect(turnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "turn_cancelled_before_acceptance",
          leaseToken: "cancel-lease-1",
          eveSessionId: null,
        }),
        data: expect.objectContaining({ status: "CANCELLED" }),
      }),
    );
  });
});

describe("SET_VERSION and fleet migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    availabilityMock.mockResolvedValue({
      disabled: false,
      disabledAt: null,
      disabledReason: null,
    });
    getEnvMock.mockReturnValue({
      SOKO_BOT_CLASSIFIER_MODE: "rules",
      SOKO_BOT_ENABLED: true,
    });
    adminActionCreateMock.mockResolvedValue({});
    adminActionFindFirstMock.mockResolvedValue(null);
    adminActionFindUniqueMock.mockResolvedValue(null);
    transactionQueryRawMock.mockResolvedValue([{ id: BOT_ID }]);
    transactionMock.mockImplementation(
      async (callback: (tx: ReturnType<typeof transactionClient>) => unknown) =>
        callback(transactionClient()),
    );
  });

  it("moves one bot and records where it came from", async () => {
    let state = adminBot({ versionId: "v14" });
    botFindUniqueMock.mockImplementation(async () => state);
    botUpdateMock.mockImplementation(async ({ data }) => {
      state = { ...state, ...data };
      return state;
    });

    await new SokoBotControlPlane().performAdminAction({
      sokoBotId: BOT_ID,
      operatorId: "admin_1",
      action: "SET_VERSION",
      versionId: "v16",
      reason: "Fleet is two versions behind",
      operationId: "fleet-v16",
    });

    expect(state.versionId).toBe("v16");
    // Nothing else on the snapshot changes, so without the version on it the
    // audit row would record a move from and to the same apparent state.
    const audit = adminActionCreateMock.mock.calls.at(-1)?.[0]?.data;
    expect(audit).toMatchObject({ status: "SUCCEEDED", targetId: "v16" });
    expect(audit.before).toMatchObject({ versionId: "v14" });
    expect(audit.after).toMatchObject({ versionId: "v16" });
  });

  it("refuses an unknown version before it writes an intent", async () => {
    // An ATTEMPTED row for a version that does not exist is an outbox entry
    // no retry could ever complete.
    botFindUniqueMock.mockResolvedValue(adminBot({ versionId: "v14" }));
    authoredVersionFindFirstMock.mockResolvedValue(null);

    await expect(
      new SokoBotControlPlane().performAdminAction({
        sokoBotId: BOT_ID,
        operatorId: "admin_1",
        action: "SET_VERSION",
        versionId: "v99-does-not-exist",
        reason: "Typo",
        operationId: "fleet-typo",
      }),
    ).rejects.toThrow(/Unknown Soko Bot version/);
    expect(adminActionCreateMock).not.toHaveBeenCalled();
  });

  it("skips bots already on the version and keeps going past a failure", async () => {
    const stuck = "01960001-0001-7001-8001-0000000000ff";
    botFindManyMock.mockResolvedValue([
      { id: BOT_ID, versionId: "v14" },
      { id: "01960001-0001-7001-8001-0000000000aa", versionId: "v16" },
      { id: stuck, versionId: "v15" },
    ]);
    botFindUniqueMock.mockImplementation(async ({ where }) =>
      where.id === stuck ? null : adminBot({ id: where.id, versionId: "v14" }),
    );
    botUpdateMock.mockImplementation(async ({ data }) => ({
      ...adminBot(),
      ...data,
    }));

    const result = await new SokoBotControlPlane().migrateVersions({
      operatorId: "admin_1",
      toVersionId: "v16",
      reason: "Bring the fleet onto the current prompt",
      operationId: "fleet-v16-2026-09-02",
    });

    // One bot that cannot be moved must not strand the other thirty.
    expect(result).toMatchObject({
      total: 3,
      moved: 1,
      alreadyOnVersion: 1,
      failed: 1,
    });
    expect(result.failures[0]?.sokoBotId).toBe(stuck);
  });

  it("gives each bot its own idempotency key", async () => {
    // One shared key would make the second bot look like a replay of the
    // first and skip it.
    botFindManyMock.mockResolvedValue([
      { id: BOT_ID, versionId: "v14" },
      { id: "01960001-0001-7001-8001-0000000000aa", versionId: "v14" },
    ]);
    botFindUniqueMock.mockImplementation(async ({ where }) =>
      adminBot({ id: where.id, versionId: "v14" }),
    );
    botUpdateMock.mockImplementation(async ({ data }) => ({
      ...adminBot(),
      ...data,
    }));

    await new SokoBotControlPlane().migrateVersions({
      operatorId: "admin_1",
      toVersionId: "v16",
      reason: "Bring the fleet onto the current prompt",
      operationId: "fleet-v16-2026-09-02",
    });

    // Two rows per bot — the ATTEMPTED intent and the SUCCEEDED outcome —
    // sharing that bot's key, and a different key per bot.
    const byBot = new Map<string, Set<string>>();
    for (const call of adminActionCreateMock.mock.calls) {
      const { sokoBotId, operationId } = call[0].data;
      byBot.set(
        sokoBotId,
        (byBot.get(sokoBotId) ?? new Set()).add(operationId),
      );
    }
    expect(byBot.size).toBe(2);
    const keys = [...byBot.values()].flatMap((set) => [...set]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });
});
