import { createHash } from "node:crypto";

import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  botFindFirstMock,
  botFindUniqueMock,
  chatRoomFindFirstMock,
  chatRoomDeleteManyMock,
  chatRoomUserMemberFindFirstMock,
  workspaceFindUniqueMock,
  chatRoomFindManyMock,
  chatMessageFindManyMock,
  botUpdateManyMock,
  contextSnapshotFindFirstMock,
  createAgentClientMock,
  createAgentJobForUserMock,
  decisionFindFirstMock,
  decisionUpdateManyMock,
  decisionUpdateMock,
  delegationCreateMock,
  delegationFindUniqueMock,
  delegationUpdateMock,
  delegationUpdateManyMock,
  getEnvMock,
  jobEventFindFirstMock,
  jobInputCreateMock,
  jobInputFindManyMock,
  jobInputFindUniqueMock,
  localJobDelegationUpdateManyMock,
  provideJobInputMock,
  requireTaskAssignableCoworkerMock,
  taskFindFirstMock,
  toolCallCreateMock,
  toolCallFindUniqueMock,
  toolCallUpdateManyMock,
  toolCallUpdateMock,
  transactionTaskFindFirstMock,
  transactionBotFindUniqueOrThrowMock,
  transactionBotUpdateMock,
  transactionMemoryRevisionCreateMock,
  transactionMemoryRevisionFindUniqueMock,
  transactionProjectFindFirstMock,
  transactionDecisionCreateMock,
  transactionDecisionFindFirstMock,
  transactionTaskCreateMock,
  transactionToolCallUpdateMock,
  transactionToolCallCountMock,
  transactionToolCallCreateMock,
  transactionToolCallFindUniqueMock,
  transactionTurnLockMock,
  transactionBotFindFirstMock,
  transactionBotUpdateManyMock,
  transactionDelegationUpdateManyMock,
  transactionTurnFindFirstMock,
  transactionTurnUpdateManyMock,
  transactionTaskUpdateMock,
  transactionWorkspaceFindFirstMock,
  transactionMock,
  turnFindUniqueMock,
  transactionChatMessageCreateMock,
  transactionChatMentionCreateManyMock,
  transactionChatRoomUpdateMock,
  chatCoworkerMemberFindManyMock,
  chatMessageCountMock,
  memberFindManyMock,
  toolCallCountMock,
  createOrGetDirectRoomMock,
  mentionFindManyMock,
  dispatchChatRoomMentionMock,
  serializableTransactionMock,
  turnUpdateManyMock,
  workspaceFindFirstMock,
  availabilityMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  botFindUniqueMock: vi.fn(),
  chatRoomFindFirstMock: vi.fn(),
  chatRoomDeleteManyMock: vi.fn(),
  chatRoomUserMemberFindFirstMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  chatRoomFindManyMock: vi.fn(),
  chatMessageFindManyMock: vi.fn(),
  botUpdateManyMock: vi.fn(),
  contextSnapshotFindFirstMock: vi.fn(),
  createAgentClientMock: vi.fn(),
  createAgentJobForUserMock: vi.fn(),
  decisionFindFirstMock: vi.fn(),
  decisionUpdateManyMock: vi.fn(),
  decisionUpdateMock: vi.fn(),
  delegationCreateMock: vi.fn(),
  delegationFindUniqueMock: vi.fn(),
  delegationUpdateMock: vi.fn(),
  delegationUpdateManyMock: vi.fn(),
  getEnvMock: vi.fn(),
  jobEventFindFirstMock: vi.fn(),
  jobInputCreateMock: vi.fn(),
  jobInputFindManyMock: vi.fn(),
  jobInputFindUniqueMock: vi.fn(),
  localJobDelegationUpdateManyMock: vi.fn(),
  provideJobInputMock: vi.fn(),
  requireTaskAssignableCoworkerMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  toolCallCreateMock: vi.fn(),
  toolCallFindUniqueMock: vi.fn(),
  toolCallUpdateManyMock: vi.fn(),
  toolCallUpdateMock: vi.fn(),
  transactionTaskFindFirstMock: vi.fn(),
  transactionBotFindUniqueOrThrowMock: vi.fn(),
  transactionBotUpdateMock: vi.fn(),
  transactionMemoryRevisionCreateMock: vi.fn(),
  transactionMemoryRevisionFindUniqueMock: vi.fn(),
  transactionProjectFindFirstMock: vi.fn(),
  transactionDecisionCreateMock: vi.fn(),
  transactionDecisionFindFirstMock: vi.fn(),
  transactionTaskCreateMock: vi.fn(),
  transactionToolCallUpdateMock: vi.fn(),
  transactionToolCallCountMock: vi.fn(),
  transactionToolCallCreateMock: vi.fn(),
  transactionToolCallFindUniqueMock: vi.fn(),
  transactionTurnLockMock: vi.fn(),
  transactionBotFindFirstMock: vi.fn(),
  transactionBotUpdateManyMock: vi.fn(),
  transactionDelegationUpdateManyMock: vi.fn(),
  transactionTurnFindFirstMock: vi.fn(),
  transactionTurnUpdateManyMock: vi.fn(),
  transactionTaskUpdateMock: vi.fn(),
  transactionWorkspaceFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
  turnFindUniqueMock: vi.fn(),
  transactionChatMessageCreateMock: vi.fn(),
  transactionChatMentionCreateManyMock: vi.fn(),
  transactionChatRoomUpdateMock: vi.fn(),
  chatCoworkerMemberFindManyMock: vi.fn(),
  chatMessageCountMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  toolCallCountMock: vi.fn(),
  createOrGetDirectRoomMock: vi.fn(),
  mentionFindManyMock: vi.fn(),
  dispatchChatRoomMentionMock: vi.fn(),
  serializableTransactionMock: vi.fn(),
  turnUpdateManyMock: vi.fn(),
  workspaceFindFirstMock: vi.fn(),
  availabilityMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: availabilityMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    sokoBot: {
      findFirst: botFindFirstMock,
      findUnique: botFindUniqueMock,
      updateMany: botUpdateManyMock,
    },
    chatRoom: {
      findFirst: chatRoomFindFirstMock,
      findMany: chatRoomFindManyMock,
      deleteMany: chatRoomDeleteManyMock,
    },
    chatRoomUserMember: { findFirst: chatRoomUserMemberFindFirstMock },
    chatRoomMessage: {
      findMany: chatMessageFindManyMock,
      count: chatMessageCountMock,
    },
    chatRoomCoworkerMember: { findMany: chatCoworkerMemberFindManyMock },
    sokoBotContextSnapshot: { findFirst: contextSnapshotFindFirstMock },
    sokoBotDelegation: {
      create: delegationCreateMock,
      findUnique: delegationFindUniqueMock,
      update: delegationUpdateMock,
      updateMany: delegationUpdateManyMock,
    },
    sokoBotPendingDecision: {
      findFirst: decisionFindFirstMock,
      update: decisionUpdateMock,
      updateMany: decisionUpdateManyMock,
    },
    sokoBotTurn: {
      findUnique: turnFindUniqueMock,
      updateMany: turnUpdateManyMock,
    },
    sokoBotToolCall: {
      count: toolCallCountMock,
      create: toolCallCreateMock,
      findUnique: toolCallFindUniqueMock,
      update: toolCallUpdateMock,
      updateMany: toolCallUpdateManyMock,
    },
    task: { findFirst: taskFindFirstMock },
    jobEvent: { findFirst: jobEventFindFirstMock },
    jobInput: {
      create: jobInputCreateMock,
      findMany: jobInputFindManyMock,
      findUnique: jobInputFindUniqueMock,
    },
    workspace: {
      findFirst: workspaceFindFirstMock,
      findUnique: workspaceFindUniqueMock,
    },
    member: { findMany: memberFindManyMock },
  },
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: serializableTransactionMock.mockImplementation(
    async (operation) =>
      operation({
        $queryRaw: transactionTurnLockMock,
        sokoBot: {
          findFirst: transactionBotFindFirstMock,
          findUniqueOrThrow: transactionBotFindUniqueOrThrowMock,
          update: transactionBotUpdateMock,
          updateMany: transactionBotUpdateManyMock,
        },
        sokoBotMemoryRevision: {
          create: transactionMemoryRevisionCreateMock,
          findUnique: transactionMemoryRevisionFindUniqueMock,
        },
        sokoBotDelegation: {
          create: delegationCreateMock,
          update: delegationUpdateMock,
          updateMany: transactionDelegationUpdateManyMock,
        },
        sokoBotPendingDecision: {
          create: transactionDecisionCreateMock,
          findFirst: transactionDecisionFindFirstMock,
        },
        sokoBotToolCall: {
          count: transactionToolCallCountMock,
          create: transactionToolCallCreateMock,
          findUnique: transactionToolCallFindUniqueMock,
          update: transactionToolCallUpdateMock,
        },
        project: { findFirst: transactionProjectFindFirstMock },
        workspace: { findFirst: transactionWorkspaceFindFirstMock },
        sokoBotTurn: {
          findFirst: transactionTurnFindFirstMock,
          updateMany: transactionTurnUpdateManyMock,
        },
        task: {
          create: transactionTaskCreateMock,
          findFirst: transactionTaskFindFirstMock,
          update: transactionTaskUpdateMock,
        },
        chatRoomMessage: { create: transactionChatMessageCreateMock },
        chatRoomMention: {
          createMany: transactionChatMentionCreateManyMock,
          findMany: mentionFindManyMock,
        },
        chatRoom: { update: transactionChatRoomUpdateMock },
      }),
  ),
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    void promise;
  },
}));
vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  dispatchChatRoomMention: dispatchChatRoomMentionMock,
}));
vi.mock("@/routes/v1/chats/rooms/helpers", async (importOriginal) => ({
  // Only room creation is stubbed; post_chat still needs the real mention
  // resolver, and stubbing that would have hidden what it actually matches.
  ...(await importOriginal<object>()),
  createOrGetDirectRoom: createOrGetDirectRoomMock,
}));
vi.mock("@/helpers/access-control", () => ({
  requireTaskAssignableCoworker: requireTaskAssignableCoworkerMock,
}));
vi.mock("@/helpers/vendor-grants", () => ({
  isGrantDeniedOrRevoked: vi.fn(() => false),
  parseGrantResumeStatus: vi.fn((status) => status),
  requestWorkspaceGrant: vi.fn(),
  requireTaskNotParked: vi.fn(),
  throwGrantAccessError: vi.fn(),
}));
vi.mock("@/helpers/job", () => ({
  createAgentJobForUser: createAgentJobForUserMock,
}));
vi.mock("@/helpers/agent", () => ({ toMasumiAgent: vi.fn() }));
vi.mock("@/helpers/task-event-charge", () => ({
  applyGuardedTaskStatusUpdate: vi.fn(),
}));
vi.mock("@/helpers/task-link", () => ({
  mapTaskLinkRelationToWriteData: vi.fn(),
}));
vi.mock("@sokosumi/masumi", () => ({
  createAgentClient: createAgentClientMock,
}));

import {
  MAX_CHAT_CHAIN_DEPTH,
  ROOM_BOT_MESSAGES_PER_HOUR,
} from "@/lib/soko-bot/chat-chain";
import {
  isSokoBotDecisionTargetAllowed,
  SokoBotRuntimeAuthorizationError,
  SokoBotRuntimeConflictError,
  SokoBotRuntimeService,
  SokoBotRuntimeValidationError,
} from "@/services/soko-bot-runtime.service";

const SCOPE = {
  userId: "user_1",
  sokoBotId: "01960001-0001-7001-8001-000000000001",
  workspaceId: "01960001-0001-7001-8001-000000000002",
  sessionId: "session_1",
  turnId: "01960001-0001-7001-8001-000000000003",
};
const DECISION_ID = "01960001-0001-7001-8001-000000000005";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function hireDecision(status: "PENDING" | "PROCESSING" = "PENDING") {
  return {
    id: DECISION_ID,
    sokoBotId: SCOPE.sokoBotId,
    turnId: SCOPE.turnId,
    userId: SCOPE.userId,
    workspaceId: SCOPE.workspaceId,
    toolName: "hire_agent",
    proposal: {
      agentId: "agent_1",
      inputSchema: {
        input_data: [{ id: "prompt", type: "string", name: "Prompt" }],
      },
      inputData: { prompt: "Prepare a launch plan" },
      maxCredits: 10,
    },
    status,
    expiresAt: new Date(Date.now() + 60_000),
    turn: {
      capabilityNames: ["hire_agent"],
      eveSessionId: SCOPE.sessionId,
    },
  };
}

function provideInputDecision(status: "PENDING" | "PROCESSING" = "PENDING") {
  return {
    ...hireDecision(status),
    toolName: "provide_job_input",
    proposal: {
      jobId: "job_1",
      eventId: "event_1",
      inputData: { answer: "Approved" },
    },
    turn: {
      capabilityNames: ["provide_job_input"],
      eveSessionId: SCOPE.sessionId,
    },
  };
}

function memoryMarkdown(activeGoal: string): string {
  return [
    "# Soko Bot memory",
    "",
    "## Active goals",
    `- ${activeGoal}`,
    "",
    "## Decisions",
    "- None",
    "",
    "## Preferences",
    "- None",
    "",
    "## Follow-ups",
    "- None",
    "",
    "## Blockers",
    "- None",
    "",
  ].join("\n");
}

describe("SokoBotRuntimeService authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    availabilityMock.mockResolvedValue({
      disabled: false,
      disabledAt: null,
      disabledReason: null,
    });
    getEnvMock.mockReturnValue({
      SOKO_BOT_ENABLED: true,
      SOKO_BOT_EVE_PROJECT_ID: "prj_soko_bot",
      SOKO_BOT_EVE_ENVIRONMENT: "production",
    });
    toolCallCreateMock.mockResolvedValue({});
    toolCallUpdateMock.mockResolvedValue({});
    transactionToolCallUpdateMock.mockResolvedValue({});
    delegationCreateMock.mockResolvedValue({});
    requireTaskAssignableCoworkerMock.mockResolvedValue(undefined);
    transactionProjectFindFirstMock.mockResolvedValue({ id: "project_1" });
    transactionTaskCreateMock.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "task_created",
        name: args.data.name,
        status: args.data.status,
        assigneeId: args.data.assigneeId,
      }),
    );
    transactionTaskUpdateMock.mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({
        id: "task_1",
        name: args.data.name ?? "Launch",
        status: args.data.status ?? TaskStatus.DRAFT,
        assigneeId: args.data.assigneeId ?? null,
      }),
    );
    transactionWorkspaceFindFirstMock.mockResolvedValue({
      id: SCOPE.workspaceId,
      organizationId: null,
    });
    workspaceFindFirstMock.mockResolvedValue({
      id: SCOPE.workspaceId,
      organizationId: null,
    });
    turnUpdateManyMock.mockResolvedValue({ count: 1 });
    botUpdateManyMock.mockResolvedValue({ count: 1 });
    transactionTurnUpdateManyMock.mockResolvedValue({ count: 1 });
    transactionBotUpdateManyMock.mockResolvedValue({ count: 1 });
    transactionTurnFindFirstMock.mockResolvedValue({
      id: SCOPE.turnId,
      eveSessionId: null,
    });
    transactionToolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallCountMock.mockResolvedValue(0);
    transactionToolCallCreateMock.mockResolvedValue({});
    transactionDecisionCreateMock.mockResolvedValue({
      id: DECISION_ID,
      status: "PENDING",
      expiresAt: new Date(Date.now() + 60_000),
    });
  });

  it("stops a turn already running when the administrator switch is thrown", async () => {
    // The switch has to reach work that started before it was thrown, not only
    // new turns; authorize runs before every tool call, so it stops there.
    availabilityMock.mockResolvedValue({
      disabled: true,
      disabledAt: new Date(),
      disabledReason: "Paused by an administrator",
    });

    const service = new SokoBotRuntimeService();
    await expect(
      service.authorize({ ...SCOPE, capability: "create_task" }),
    ).rejects.toThrow(SokoBotRuntimeAuthorizationError);
  });

  it("denies capability execution after cancellation is requested", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["create_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "CANCEL_REQUESTED",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });

    const service = new SokoBotRuntimeService();
    await expect(
      service.authorize({
        ...SCOPE,
        capability: "create_task",
      }),
    ).rejects.toThrow(SokoBotRuntimeAuthorizationError);
  });

  it("carries the turn's version and source into the action context", async () => {
    // Dropping these silently made every turn resolve the default version and
    // meant self-started turns could not be told apart from owner turns.
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["create_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      versionId: "inbox-tuned",
      source: "SCHEDULE",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });

    const service = new SokoBotRuntimeService();
    const authorized = await service.authorize({
      ...SCOPE,
      capability: "create_task",
    });

    expect(authorized.turn.versionId).toBe("inbox-tuned");
    expect(authorized.turn.source).toBe("SCHEDULE");
  });

  it("denies Context reads while cancellation settles", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["create_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "CANCEL_REQUESTED",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });

    const service = new SokoBotRuntimeService();
    await expect(
      service.authorize({
        ...SCOPE,
      }),
    ).rejects.toThrow("cancellation is pending");
  });

  it("does not attach a pending Eve session after administrator PAUSE wins", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: null,
      status: "STARTING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        adminPausedAt: null,
        archivedAt: null,
        status: "RUNNING",
      },
    });
    // PAUSE commits after the optimistic read but before authorization binds
    // the pending session. The locked/reloaded turn is no longer eligible.
    transactionTurnFindFirstMock.mockResolvedValue(null);

    await expect(
      new SokoBotRuntimeService().authorize({
        ...SCOPE,
        capability: "get_task_status",
      }),
    ).rejects.toThrow(SokoBotRuntimeAuthorizationError);

    expect(transactionTurnLockMock).toHaveBeenCalledTimes(2);
    expect(transactionTurnFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["STARTING", "RUNNING"] },
          leaseExpiresAt: { gt: expect.any(Date) },
          sokoBot: expect.objectContaining({
            adminPausedAt: null,
            archivedAt: null,
            status: { not: "PAUSED" },
          }),
        }),
      }),
    );
    expect(transactionTurnUpdateManyMock).not.toHaveBeenCalled();
    expect(transactionBotUpdateManyMock).not.toHaveBeenCalled();
    expect(turnUpdateManyMock).not.toHaveBeenCalled();
    expect(botUpdateManyMock).not.toHaveBeenCalled();
  });

  it("atomically attaches an eligible pending Eve session to turn and bot", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: null,
      status: "STARTING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        adminPausedAt: null,
        archivedAt: null,
        status: "RUNNING",
      },
    });
    transactionTurnFindFirstMock.mockResolvedValue({
      id: SCOPE.turnId,
      eveSessionId: null,
    });

    const authorized = await new SokoBotRuntimeService().authorize({
      ...SCOPE,
      capability: "get_task_status",
    });

    expect(authorized.turn.eveSessionId).toBe(SCOPE.sessionId);
    expect(transactionTurnLockMock).toHaveBeenCalledTimes(2);
    expect(transactionTurnUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          eveSessionId: null,
          status: { in: ["STARTING", "RUNNING"] },
          leaseExpiresAt: { gt: expect.any(Date) },
          sokoBot: expect.objectContaining({
            adminPausedAt: null,
            archivedAt: null,
            status: { not: "PAUSED" },
          }),
        }),
        data: { eveSessionId: SCOPE.sessionId },
      }),
    );
    expect(transactionBotUpdateManyMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: SCOPE.sokoBotId,
        adminPausedAt: null,
        archivedAt: null,
        status: { not: "PAUSED" },
      }),
      data: { eveSessionId: SCOPE.sessionId },
    });
    expect(turnUpdateManyMock).not.toHaveBeenCalled();
    expect(botUpdateManyMock).not.toHaveBeenCalled();
  });

  it("accepts an overlapping retry after the same Eve session was attached", async () => {
    // Both requests optimistically read null. This request then waits for the
    // first request's transaction and reloads the exact same bound session.
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: null,
      status: "STARTING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        adminPausedAt: null,
        archivedAt: null,
        status: "RUNNING",
      },
    });
    transactionTurnFindFirstMock.mockResolvedValue({
      id: SCOPE.turnId,
      eveSessionId: SCOPE.sessionId,
    });
    transactionTurnUpdateManyMock.mockResolvedValue({ count: 0 });

    const authorized = await new SokoBotRuntimeService().authorize({
      ...SCOPE,
      capability: "get_task_status",
    });

    expect(authorized.turn.eveSessionId).toBe(SCOPE.sessionId);
    expect(transactionTurnFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ eveSessionId: null }, { eveSessionId: SCOPE.sessionId }],
        }),
        select: { eveSessionId: true, id: true, source: true },
      }),
    );
    expect(transactionTurnUpdateManyMock).not.toHaveBeenCalled();
    expect(transactionBotUpdateManyMock).toHaveBeenCalledOnce();
  });

  it("rejects a pending attachment when a different Eve session won", async () => {
    const differentSessionId = "session_different_request";
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: null,
      status: "STARTING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        adminPausedAt: null,
        archivedAt: null,
        status: "RUNNING",
      },
    });
    // Defensive mock: even if a delegate returned a row outside its session
    // predicate, authorization must never adopt another request's session.
    transactionTurnFindFirstMock.mockResolvedValue({
      id: SCOPE.turnId,
      eveSessionId: differentSessionId,
    });

    await expect(
      new SokoBotRuntimeService().authorize({
        ...SCOPE,
        capability: "get_task_status",
      }),
    ).rejects.toThrow("session attachment became stale");

    expect(transactionTurnUpdateManyMock).not.toHaveBeenCalled();
    expect(transactionBotUpdateManyMock).not.toHaveBeenCalled();
  });

  it("replaces the prior completed turn session when attaching a new turn", async () => {
    const priorSessionId = "session_previous_turn";
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: null,
      status: "STARTING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        adminPausedAt: null,
        archivedAt: null,
        eveSessionId: priorSessionId,
        status: "RUNNING",
      },
    });
    transactionTurnFindFirstMock.mockResolvedValue({
      id: SCOPE.turnId,
      eveSessionId: null,
    });
    transactionBotUpdateManyMock.mockImplementation(
      async (args: { where: Record<string, unknown> }) => {
        const where = args.where;
        const sessionPredicate =
          "eveSessionId" in where ||
          (Array.isArray(where.OR) &&
            where.OR.some(
              (branch) =>
                typeof branch === "object" &&
                branch !== null &&
                "eveSessionId" in branch,
            ));
        return { count: sessionPredicate ? 0 : 1 };
      },
    );

    const authorized = await new SokoBotRuntimeService().authorize({
      ...SCOPE,
      capability: "get_task_status",
    });

    expect(authorized.turn.eveSessionId).toBe(SCOPE.sessionId);
    expect(transactionBotUpdateManyMock).toHaveBeenCalledWith({
      where: expect.not.objectContaining({
        OR: expect.anything(),
        eveSessionId: expect.anything(),
      }),
      data: { eveSessionId: SCOPE.sessionId },
    });
  });

  it("denies Context reads after current workspace access is revoked", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["create_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        adminPausedAt: null,
        archivedAt: null,
        status: "RUNNING",
      },
    });
    workspaceFindFirstMock.mockResolvedValue(null);
    contextSnapshotFindFirstMock.mockResolvedValue({
      packet: {},
      hash: "hash",
      schemaVersion: 1,
      generatedAt: new Date(),
    });

    await expect(
      new SokoBotRuntimeService().getContext({
        ...SCOPE,
      }),
    ).rejects.toThrow("Workspace access is no longer available");

    expect(workspaceFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: SCOPE.workspaceId,
          OR: [
            { userId: SCOPE.userId },
            {
              organization: {
                members: { some: { userId: SCOPE.userId } },
              },
            },
          ],
        },
      }),
    );
    expect(contextSnapshotFindFirstMock).not.toHaveBeenCalled();
  });

  it("fails closed when capability was not granted for turn", async () => {
    const service = new SokoBotRuntimeService();

    // The turn row is what grants capabilities, so it is read first and the
    // check fails closed on what it says — not on a caller-supplied claim.
    await expect(
      service.authorize({
        ...SCOPE,
        capability: "hire_agent",
      }),
    ).rejects.toThrow("Capability is not granted");
  });

  it("does not let a decision target exceed originating capabilities", () => {
    expect(
      isSokoBotDecisionTargetAllowed("hire_agent", [
        "create_task",
        "request_user_decision",
      ]),
    ).toBe(false);
    expect(
      isSokoBotDecisionTargetAllowed("create_task", [
        "create_task",
        "request_user_decision",
      ]),
    ).toBe(true);
    expect(
      isSokoBotDecisionTargetAllowed("clarify_scope", [
        "request_user_decision",
      ]),
    ).toBe(false);
  });

  it("reclaims a stale in-flight read tool call", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000010",
      status: "PENDING",
      capability: "get_task_status",
      inputHash:
        "ebec1e2278dde6f0f0819b8d9bda37d57a184fafba6dd187b79a54d3246099cd",
      updatedAt: new Date(0),
    });
    toolCallUpdateManyMock.mockResolvedValue({ count: 1 });
    taskFindFirstMock.mockResolvedValue({
      id: "task_1",
      name: "Launch",
      status: "READY",
      events: [],
      files: [],
      linksFrom: [],
      linksTo: [],
    });

    const service = new SokoBotRuntimeService();
    const result = await service.executeTool({
      ...SCOPE,
      capability: "get_task_status",
      toolCallId: "call_1",
      input: { taskId: "task_1" },
    });

    expect(result).toMatchObject({ id: "task_1", status: "READY" });
    expect(toolCallUpdateManyMock).toHaveBeenCalledOnce();
    expect(toolCallUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("keeps a fresh in-flight tool call single-flight", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000010",
      status: "PENDING",
      capability: "get_task_status",
      inputHash:
        "ebec1e2278dde6f0f0819b8d9bda37d57a184fafba6dd187b79a54d3246099cd",
      updatedAt: new Date(),
    });
    toolCallUpdateManyMock.mockResolvedValue({ count: 0 });

    const service = new SokoBotRuntimeService();
    await expect(
      service.executeTool({
        ...SCOPE,
        capability: "get_task_status",
        toolCallId: "call_1",
        input: { taskId: "task_1" },
      }),
    ).rejects.toThrow(SokoBotRuntimeConflictError);
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it("enforces a finite tool-call ceiling per turn", async () => {
    turnFindUniqueMock.mockResolvedValue({
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      userMessage: "Check task",
      classification: { confidence: 1 },
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallCountMock.mockResolvedValue(64);

    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "get_task_status",
        toolCallId: "call_over_limit",
        input: { taskId: "task_1" },
      }),
    ).rejects.toThrow("tool-call limit reached");

    expect(transactionToolCallCreateMock).not.toHaveBeenCalled();
    expect(taskFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns raw tool result but persists bounded redacted evidence", async () => {
    turnFindUniqueMock.mockResolvedValue({
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      userMessage: "Check task",
      classification: { confidence: 1 },
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    const rawResult = {
      id: "task_1",
      name: "password: correct-horse-battery-staple",
      status: "READY",
      description: `api_key: opaque-nested-credential payment_token: opaque-nested-payment ${"x".repeat(30_000)}`,
      assignee: null,
      project: null,
      events: [],
      files: [],
      linksFrom: [],
      linksTo: [],
    };
    taskFindFirstMock.mockResolvedValue(rawResult);

    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "get_task_status",
      toolCallId: "call_redacted_result",
      input: { taskId: "task_1" },
    });

    expect(result).toMatchObject({
      name: rawResult.name,
      description: rawResult.description,
    });
    const persisted = toolCallUpdateMock.mock.calls.at(-1)?.[0]?.data.result;
    const serialized = JSON.stringify(persisted);
    expect(Buffer.byteLength(serialized, "utf8")).toBeLessThanOrEqual(16_384);
    expect(serialized).not.toContain("correct-horse-battery-staple");
    expect(serialized).not.toContain("opaque-nested-credential");
    expect(serialized).not.toContain("opaque-nested-payment");
    expect(serialized).toContain("Sensitive value removed");
  });

  it("redacts and bounds persisted tool errors", async () => {
    turnFindUniqueMock.mockResolvedValue({
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      userMessage: "Check task",
      classification: { confidence: 1 },
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    taskFindFirstMock.mockRejectedValue(
      new Error(`password: correct-horse-battery-staple ${"x".repeat(2_000)}`),
    );

    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "get_task_status",
        toolCallId: "call_redacted_error",
        input: { taskId: "task_1" },
      }),
    ).rejects.toThrow("correct-horse-battery-staple");

    const detail = toolCallUpdateManyMock.mock.calls.at(-1)?.[0]?.data
      .errorDetail as string;
    expect(Buffer.byteLength(detail, "utf8")).toBeLessThanOrEqual(1_000);
    expect(detail).toBe("[Sensitive value removed]");
  });

  it("rejects mutation when stored user message contains negative imperative", async () => {
    turnFindUniqueMock.mockResolvedValue({
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["create_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      userMessage: "Don't create a task yet",
      classification: { confidence: 1 },
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);

    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "create_task",
        toolCallId: "call_negated",
        input: { name: "Forbidden", status: "DRAFT" },
      }),
    ).rejects.toThrow("explicitly asked for this not to");

    expect(transactionDecisionCreateMock).not.toHaveBeenCalled();
    expect(transactionTaskCreateMock).not.toHaveBeenCalled();
  });

  it("creates Task through shared domain operation with Soko Bot attribution", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["create_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);

    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "create_task",
      toolCallId: "call_create_shared",
      input: { name: "Launch", status: "DRAFT" },
    });

    expect(result).toEqual({
      id: "task_created",
      name: "Launch",
      status: TaskStatus.DRAFT,
      assigneeId: null,
    });
    expect(transactionTaskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          creatorOrchestratorId: SCOPE.sokoBotId,
          events: {
            create: expect.objectContaining({
              channel: "SOKOSUMI",
              orchestratorId: SCOPE.sokoBotId,
              status: TaskStatus.DRAFT,
            }),
          },
        }),
      }),
    );
    expect(delegationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "create_task",
        taskId: "task_created",
      }),
    });
  });

  it("shares project/workspace rejection with normal Task create", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["create_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionProjectFindFirstMock.mockResolvedValue(null);

    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "create_task",
        toolCallId: "call_bad_project",
        input: {
          name: "Launch",
          projectId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          status: "DRAFT",
        },
      }),
    ).rejects.toThrow("Project not found");

    expect(transactionProjectFindFirstMock).toHaveBeenCalledWith({
      where: {
        id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
        workspaceId: SCOPE.workspaceId,
      },
      select: { id: true },
    });
    expect(transactionTaskCreateMock).not.toHaveBeenCalled();
  });

  it("assigns a Task directly through shared assignee and status-event policy", async () => {
    turnFindUniqueMock.mockResolvedValue({
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["assign_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      userMessage: "Assign it",
      classification: { confidence: 0.3 },
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: { archivedAt: null, status: "RUNNING" },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionTaskFindFirstMock.mockResolvedValue({
      id: "task_1",
      ownerId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["assign_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      status: TaskStatus.DRAFT,
      assigneeId: null,
    });
    transactionTaskUpdateMock.mockResolvedValue({
      id: "task_1",
      name: "Launch",
      status: TaskStatus.READY,
      assigneeId: "coworker_1",
    });

    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "assign_task",
      toolCallId: "call_assign_direct",
      input: { taskId: "task_1", coworkerId: "coworker_1", ready: true },
    });

    expect(result).toMatchObject({
      id: "task_1",
      status: TaskStatus.READY,
      assigneeId: "coworker_1",
    });
    expect(transactionDecisionCreateMock).not.toHaveBeenCalled();
    expect(requireTaskAssignableCoworkerMock).toHaveBeenCalledWith(
      "coworker_1",
      SCOPE.workspaceId,
      expect.anything(),
      { kind: "soko_bot", sokoBotId: SCOPE.sokoBotId },
    );
  });

  it("limits Task updates to DRAFT and READY records", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["update_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionTaskFindFirstMock.mockResolvedValue(null);

    const service = new SokoBotRuntimeService();
    await expect(
      service.executeTool({
        ...SCOPE,
        capability: "update_task",
        toolCallId: "call_2",
        input: { taskId: "task_1", name: "Changed" },
      }),
    ).rejects.toThrow("Task not found");

    expect(transactionTaskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["DRAFT", "READY"] },
        }),
      }),
    );
  });

  it("denies a Task mutation after workspace access is revoked", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["update_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionWorkspaceFindFirstMock.mockResolvedValue(null);

    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "update_task",
        toolCallId: "call_revoked_workspace",
        input: { taskId: "task_1", name: "Changed" },
      }),
    ).rejects.toThrow("Workspace access is no longer available");

    expect(transactionTurnLockMock).toHaveBeenCalledTimes(2);
    expect(transactionTaskFindFirstMock).not.toHaveBeenCalled();
  });
});

describe("SokoBotRuntimeService memory updates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      SOKO_BOT_ENABLED: true,
      SOKO_BOT_EVE_PROJECT_ID: "prj_soko_bot",
      SOKO_BOT_EVE_ENVIRONMENT: "production",
    });
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["update_memory"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: {
        archivedAt: null,
        status: "RUNNING",
      },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    toolCallCreateMock.mockResolvedValue({});
    toolCallUpdateMock.mockResolvedValue({});
    toolCallUpdateManyMock.mockResolvedValue({ count: 1 });
    transactionWorkspaceFindFirstMock.mockResolvedValue({
      id: SCOPE.workspaceId,
      organizationId: null,
    });
    workspaceFindFirstMock.mockResolvedValue({
      id: SCOPE.workspaceId,
      organizationId: null,
    });
    transactionTurnFindFirstMock.mockResolvedValue({ id: SCOPE.turnId });
    transactionBotUpdateMock.mockResolvedValue({});
    transactionToolCallUpdateMock.mockResolvedValue({});
  });

  it("rejects secret-bearing memory before persistence", async () => {
    transactionBotFindUniqueOrThrowMock.mockResolvedValue({ memoryVersion: 1 });

    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "update_memory",
        toolCallId: "memory_secret",
        input: {
          markdown: memoryMarkdown(
            "Database password: correct-horse-battery-staple",
          ),
        },
      }),
    ).rejects.toThrow(SokoBotRuntimeValidationError);

    expect(transactionMemoryRevisionCreateMock).not.toHaveBeenCalled();
    expect(transactionBotUpdateMock).not.toHaveBeenCalled();
  });

  it("allows repeated updates when latest memory revision belongs to same turn", async () => {
    transactionBotFindUniqueOrThrowMock
      .mockResolvedValueOnce({ memoryVersion: 1 })
      .mockResolvedValueOnce({ memoryVersion: 2 });
    transactionMemoryRevisionFindUniqueMock.mockResolvedValue({
      sourceTurnId: SCOPE.turnId,
    });
    transactionMemoryRevisionCreateMock
      .mockResolvedValueOnce({
        id: "01960001-0001-7001-8001-000000000021",
        version: 2,
        hash: "hash_2",
        markdown: memoryMarkdown("Ship launch"),
      })
      .mockResolvedValueOnce({
        id: "01960001-0001-7001-8001-000000000022",
        version: 3,
        hash: "hash_3",
        markdown: memoryMarkdown("Ship launch safely"),
      });
    const service = new SokoBotRuntimeService();

    await service.executeTool({
      ...SCOPE,
      capability: "update_memory",
      toolCallId: "memory_1",
      input: { markdown: memoryMarkdown("Ship launch") },
    });
    await service.executeTool({
      ...SCOPE,
      capability: "update_memory",
      toolCallId: "memory_2",
      input: { markdown: memoryMarkdown("Ship launch safely") },
    });

    expect(transactionMemoryRevisionFindUniqueMock).toHaveBeenCalledWith({
      where: {
        sokoBotId_version: { sokoBotId: SCOPE.sokoBotId, version: 2 },
      },
      select: { sourceTurnId: true },
    });
    expect(transactionMemoryRevisionCreateMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          sourceTurnId: SCOPE.turnId,
          version: 3,
        }),
      }),
    );
  });

  it("keeps optimistic conflict when another turn changed memory", async () => {
    transactionBotFindUniqueOrThrowMock.mockResolvedValue({ memoryVersion: 2 });
    transactionMemoryRevisionFindUniqueMock.mockResolvedValue({
      sourceTurnId: "01960001-0001-7001-8001-000000000099",
    });

    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "update_memory",
        toolCallId: "memory_conflict",
        input: { markdown: memoryMarkdown("Overwrite another turn") },
      }),
    ).rejects.toThrow(SokoBotRuntimeConflictError);

    expect(transactionMemoryRevisionCreateMock).not.toHaveBeenCalled();
  });
});

describe("SokoBotRuntimeService hire decisions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    decisionFindFirstMock.mockResolvedValue(hireDecision());
    decisionUpdateManyMock.mockResolvedValue({ count: 1 });
    botFindFirstMock.mockResolvedValue({ id: SCOPE.sokoBotId });
    workspaceFindFirstMock.mockResolvedValue({
      id: SCOPE.workspaceId,
      organizationId: null,
    });
    transactionMock.mockImplementation(async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
    );
    delegationFindUniqueMock.mockResolvedValue(null);
    delegationCreateMock.mockResolvedValue({});
    delegationUpdateMock.mockResolvedValue({});
    delegationUpdateManyMock.mockResolvedValue({ count: 1 });
    localJobDelegationUpdateManyMock.mockResolvedValue({ count: 1 });
    transactionDelegationUpdateManyMock.mockResolvedValue({ count: 1 });
    transactionBotFindFirstMock.mockResolvedValue({ id: SCOPE.sokoBotId });
    createAgentClientMock.mockReturnValue({
      provideJobInput: provideJobInputMock,
    });
    provideJobInputMock.mockResolvedValue({
      isErr: () => false,
      value: { input_hash: "input-hash", signature: "input-signature" },
    });
    jobInputCreateMock.mockResolvedValue({ id: "input_1" });
    jobInputFindManyMock.mockResolvedValue([]);
    jobInputFindUniqueMock.mockResolvedValue(null);
    createAgentJobForUserMock.mockImplementation(
      async (input: {
        beforeSellerStart?: () => Promise<void>;
        afterLocalJobCreate?: (
          job: { id: string },
          tx: {
            sokoBotDelegation: {
              updateMany: typeof localJobDelegationUpdateManyMock;
            };
          },
        ) => Promise<void>;
      }) => {
        await input.beforeSellerStart?.();
        const job = { id: "job_1" };
        await input.afterLocalJobCreate?.(job, {
          sokoBotDelegation: {
            updateMany: localJobDelegationUpdateManyMock,
          },
        });
        return job;
      },
    );
    decisionUpdateMock.mockResolvedValue({
      ...hireDecision("PROCESSING"),
      status: "ACCEPTED",
      resultingEntityId: "job_1",
    });
  });

  it("reserves an approved hire before starting its Agent Job", async () => {
    const sellerStartMock = vi.fn();
    createAgentJobForUserMock.mockImplementationOnce(
      async (input: {
        beforeSellerStart?: () => Promise<void>;
        afterLocalJobCreate?: (
          job: { id: string },
          tx: {
            sokoBotDelegation: {
              updateMany: typeof localJobDelegationUpdateManyMock;
            };
          },
        ) => Promise<void>;
      }) => {
        await input.beforeSellerStart?.();
        sellerStartMock();
        const job = { id: "job_1" };
        await input.afterLocalJobCreate?.(job, {
          sokoBotDelegation: {
            updateMany: localJobDelegationUpdateManyMock,
          },
        });
        return job;
      },
    );
    const resolved = await new SokoBotRuntimeService().resolveDecision(
      SCOPE.userId,
      DECISION_ID,
      true,
    );

    expect(resolved).toMatchObject({
      status: "ACCEPTED",
      resultingEntityId: "job_1",
    });
    expect(delegationCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        turnId: SCOPE.turnId,
        toolCallId: `decision:${DECISION_ID}`,
        outcome: "processing",
        error: expect.any(String),
      }),
    });
    const reservation = JSON.parse(
      delegationCreateMock.mock.calls[0]?.[0]?.data.error,
    );
    expect(reservation).toMatchObject({
      version: 1,
      attemptId: expect.any(String),
      reservedAt: expect.any(String),
      proposalHash: expect.any(String),
    });
    expect(delegationCreateMock.mock.invocationCallOrder[0]).toBeLessThan(
      sellerStartMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(transactionTurnLockMock.mock.invocationCallOrder[0]).toBeLessThan(
      sellerStartMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(transactionBotFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { not: "PAUSED" } }),
      }),
    );
    expect(localJobDelegationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          outcome: "processing",
          error: expect.any(String),
        }),
        data: { outcome: "accepted", jobId: "job_1", error: null },
      }),
    );
    expect(sellerStartMock.mock.invocationCallOrder[0]).toBeLessThan(
      localJobDelegationUpdateManyMock.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it("never returns a hire to PENDING after seller-side execution starts", async () => {
    decisionUpdateMock.mockRejectedValueOnce(
      new Error("database connection lost after Job creation"),
    );

    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow("database connection lost");

    expect(createAgentJobForUserMock).toHaveBeenCalledOnce();
    expect(decisionUpdateManyMock).toHaveBeenCalledOnce();
    expect(decisionUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING" }),
      }),
    );
    expect(decisionUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "EXPIRED" }),
      }),
    );
    expect(delegationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "ambiguous" }),
      }),
    );
  });

  it("returns a hire to PENDING when preflight fails before seller execution", async () => {
    createAgentJobForUserMock.mockRejectedValueOnce(
      new Error("Credit cost exceeds maximum accepted credits"),
    );

    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow("Credit cost exceeds maximum accepted credits");

    expect(delegationCreateMock).not.toHaveBeenCalled();
    expect(decisionUpdateManyMock).toHaveBeenLastCalledWith({
      where: { id: DECISION_ID, status: "PROCESSING" },
      data: { status: "PENDING", resolvedByUserId: null },
    });
  });

  it("recovers a processing decision from its exact Delegation Job link", async () => {
    decisionFindFirstMock.mockResolvedValue(hireDecision("PROCESSING"));
    delegationFindUniqueMock.mockResolvedValue({ jobId: "job_1" });

    const resolved = await new SokoBotRuntimeService().resolveDecision(
      SCOPE.userId,
      DECISION_ID,
      true,
    );

    expect(resolved).toMatchObject({
      status: "ACCEPTED",
      resultingEntityId: "job_1",
    });
    expect(createAgentJobForUserMock).not.toHaveBeenCalled();
    expect(jobInputFindManyMock).not.toHaveBeenCalled();
    expect(decisionUpdateManyMock).not.toHaveBeenCalled();
  });

  it("keeps an unlinked ambiguous processing hire recoverable", async () => {
    decisionFindFirstMock.mockResolvedValue(hireDecision("PROCESSING"));
    delegationFindUniqueMock.mockResolvedValue({ jobId: null });

    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow("processing outcome is ambiguous");

    expect(createAgentJobForUserMock).not.toHaveBeenCalled();
    expect(decisionUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "EXPIRED" }),
      }),
    );
  });

  it("does not infer a processing hire from matching input shape", async () => {
    const proposal = hireDecision("PROCESSING").proposal;
    const proposalHash = createHash("sha256")
      .update(`hire_agent:${canonicalJson(proposal)}`)
      .digest("hex");
    decisionFindFirstMock.mockResolvedValue(hireDecision("PROCESSING"));
    delegationFindUniqueMock.mockResolvedValue({
      jobId: null,
      outcome: "ambiguous",
      error: JSON.stringify({
        version: 1,
        attemptId: "attempt_1",
        reservedAt: "2026-08-18T10:00:00.000Z",
        proposalHash,
      }),
    });
    jobInputFindManyMock.mockResolvedValue([
      { event: { jobId: "job_recovered" } },
    ]);
    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow("Pending decision processing outcome is ambiguous");

    expect(createAgentJobForUserMock).not.toHaveBeenCalled();
    expect(jobInputFindManyMock).not.toHaveBeenCalled();
    expect(decisionUpdateMock).not.toHaveBeenCalled();
  });

  it("assigns through shared assignee and status-event policy once accepted", async () => {
    decisionFindFirstMock.mockResolvedValue({
      ...hireDecision("PENDING"),
      toolName: "assign_task",
      proposal: { taskId: "task_1", coworkerId: "coworker_1", ready: true },
      turn: {
        capabilityNames: ["assign_task"],
        eveSessionId: SCOPE.sessionId,
      },
    });
    transactionTaskFindFirstMock.mockResolvedValue({
      id: "task_1",
      ownerId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["create_task"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      status: TaskStatus.DRAFT,
      assigneeId: null,
    });
    transactionTaskUpdateMock.mockResolvedValue({
      id: "task_1",
      name: "Launch",
      status: TaskStatus.READY,
      assigneeId: "coworker_1",
    });
    decisionUpdateMock.mockResolvedValue({
      status: "ACCEPTED",
      resultingEntityId: "task_1",
    });

    const resolved = await new SokoBotRuntimeService().resolveDecision(
      SCOPE.userId,
      DECISION_ID,
      true,
    );

    expect(resolved).toMatchObject({
      status: "ACCEPTED",
      resultingEntityId: "task_1",
    });
    expect(requireTaskAssignableCoworkerMock).toHaveBeenCalledWith(
      "coworker_1",
      SCOPE.workspaceId,
      expect.anything(),
      { kind: "soko_bot", sokoBotId: SCOPE.sokoBotId },
    );
    expect(transactionTaskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeId: "coworker_1",
          status: TaskStatus.READY,
        }),
      }),
    );
  });

  it("limits accepted Task assignment to pre-execution records", async () => {
    decisionFindFirstMock.mockResolvedValue({
      ...hireDecision("PENDING"),
      toolName: "assign_task",
      proposal: { taskId: "task_1", coworkerId: "coworker_1", ready: true },
      turn: {
        capabilityNames: ["assign_task"],
        eveSessionId: SCOPE.sessionId,
      },
    });
    transactionTaskFindFirstMock.mockResolvedValue(null);

    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow("Task not found");

    expect(transactionTaskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["DRAFT", "READY"] },
        }),
      }),
    );
  });

  it("finalizes a processing task from its durable Task link", async () => {
    decisionFindFirstMock.mockResolvedValue({
      ...hireDecision("PROCESSING"),
      toolName: "create_task",
      proposal: { name: "Launch", status: "DRAFT" },
      turn: {
        capabilityNames: ["create_task"],
        eveSessionId: SCOPE.sessionId,
      },
    });
    delegationFindUniqueMock.mockResolvedValue({ taskId: "task_1" });
    decisionUpdateMock.mockResolvedValue({
      status: "ACCEPTED",
      resultingEntityId: "task_1",
    });

    const resolved = await new SokoBotRuntimeService().resolveDecision(
      SCOPE.userId,
      DECISION_ID,
      true,
    );

    expect(resolved).toMatchObject({
      status: "ACCEPTED",
      resultingEntityId: "task_1",
    });
    expect(transactionTaskCreateMock).not.toHaveBeenCalled();
  });

  it("resumes a processing Task decision when atomic delegation is absent", async () => {
    decisionFindFirstMock.mockResolvedValue({
      ...hireDecision("PROCESSING"),
      toolName: "create_task",
      proposal: { name: "Launch", status: "DRAFT" },
      turn: {
        capabilityNames: ["create_task"],
        eveSessionId: SCOPE.sessionId,
      },
    });
    delegationFindUniqueMock.mockResolvedValue(null);
    transactionWorkspaceFindFirstMock.mockResolvedValue({
      id: SCOPE.workspaceId,
      organizationId: null,
    });
    transactionTaskCreateMock.mockResolvedValue({
      id: "task_resumed",
      name: "Launch",
      status: "DRAFT",
      assigneeId: null,
    });
    decisionUpdateMock.mockResolvedValue({
      status: "ACCEPTED",
      resultingEntityId: "task_resumed",
    });

    const resolved = await new SokoBotRuntimeService().resolveDecision(
      SCOPE.userId,
      DECISION_ID,
      true,
    );

    expect(resolved).toMatchObject({ resultingEntityId: "task_resumed" });
    expect(transactionTurnLockMock).toHaveBeenCalledOnce();
    expect(transactionTaskCreateMock).toHaveBeenCalledOnce();
    expect(decisionUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "PENDING" } }),
    );
  });

  it("finalizes processing job input from its durable receipt", async () => {
    decisionFindFirstMock.mockResolvedValue(provideInputDecision("PROCESSING"));
    delegationFindUniqueMock.mockResolvedValue(null);
    jobInputFindUniqueMock.mockResolvedValue({ id: "input_1" });
    decisionUpdateMock.mockResolvedValue({
      status: "ACCEPTED",
      resultingEntityId: "input_1",
    });

    const resolved = await new SokoBotRuntimeService().resolveDecision(
      SCOPE.userId,
      DECISION_ID,
      true,
    );

    expect(resolved).toMatchObject({
      status: "ACCEPTED",
      resultingEntityId: "input_1",
    });
    expect(provideJobInputMock).not.toHaveBeenCalled();
    expect(delegationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "accepted", error: null }),
      }),
    );
  });

  it.each([
    ["unreachable", "PENDING", "failed"],
    ["ambiguous", "PROCESSING", "ambiguous"],
    ["invalid-response", "PROCESSING", "ambiguous"],
  ] as const)(
    "handles %s provide_input failure without stuck PROCESSING",
    async (kind, decisionStatus, outcome) => {
      decisionFindFirstMock.mockResolvedValue(provideInputDecision());
      jobEventFindFirstMock.mockResolvedValue({
        id: "event_1",
        input: null,
        inputSchema: JSON.stringify({ input_data: [] }),
        job: {
          id: "job_1",
          agentJobId: "seller-job-1",
          agentBlockchainIdentifier: null,
          agentApiBaseUrl: null,
          agent: {
            id: "agent_1",
            name: "Agent",
            blockchainIdentifier: "seller-agent-1",
            apiBaseUrl: "https://agent.example.com",
            metadataOverride: null,
          },
        },
      });
      provideJobInputMock.mockResolvedValue({
        isErr: () => true,
        error: { kind, message: `seller ${kind}` },
      });

      await expect(
        new SokoBotRuntimeService().resolveDecision(
          SCOPE.userId,
          DECISION_ID,
          true,
        ),
      ).rejects.toThrow(`seller ${kind}`);

      expect(delegationUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outcome }),
        }),
      );
      expect(decisionUpdateManyMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: decisionStatus }),
        }),
      );
    },
  );

  it("keeps accepted input recoverable when local receipt persistence fails", async () => {
    decisionFindFirstMock.mockResolvedValue(provideInputDecision());
    jobEventFindFirstMock.mockResolvedValue({
      id: "event_1",
      input: null,
      inputSchema: JSON.stringify({ input_data: [] }),
      job: {
        id: "job_1",
        agentJobId: "seller-job-1",
        agentBlockchainIdentifier: null,
        agentApiBaseUrl: null,
        agent: {
          id: "agent_1",
          name: "Agent",
          blockchainIdentifier: "seller-agent-1",
          apiBaseUrl: "https://agent.example.com",
          metadataOverride: null,
        },
      },
    });
    jobInputCreateMock.mockRejectedValue(new Error("receipt write failed"));

    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow("receipt write failed");

    expect(delegationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "ambiguous" }),
      }),
    );
    expect(decisionUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "EXPIRED" }),
      }),
    );
  });

  it("retries an explicitly failed input reservation without duplicate Delegation", async () => {
    decisionFindFirstMock.mockResolvedValue(provideInputDecision());
    delegationFindUniqueMock.mockResolvedValue({ outcome: "failed" });
    jobEventFindFirstMock.mockResolvedValue({
      id: "event_1",
      input: null,
      inputSchema: JSON.stringify({ input_data: [] }),
      job: {
        id: "job_1",
        agentJobId: "seller-job-1",
        agentBlockchainIdentifier: null,
        agentApiBaseUrl: null,
        agent: {
          id: "agent_1",
          name: "Agent",
          blockchainIdentifier: "seller-agent-1",
          apiBaseUrl: "https://agent.example.com",
          metadataOverride: null,
        },
      },
    });

    await new SokoBotRuntimeService().resolveDecision(
      SCOPE.userId,
      DECISION_ID,
      true,
    );

    expect(delegationCreateMock).not.toHaveBeenCalled();
    expect(transactionDelegationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ outcome: "failed" }),
        data: expect.objectContaining({
          outcome: "processing",
          error: expect.any(String),
        }),
      }),
    );
  });

  it("allows exactly one failed-reservation retry to cross the seller fence", async () => {
    const sellerStartMock = vi.fn();
    decisionFindFirstMock.mockResolvedValue(hireDecision("PROCESSING"));
    delegationFindUniqueMock.mockResolvedValue({
      outcome: "failed",
      error: "old-attempt-fence",
    });
    transactionDelegationUpdateManyMock.mockResolvedValue({ count: 0 });
    createAgentJobForUserMock.mockImplementationOnce(
      async (input: { beforeSellerStart?: () => Promise<void> }) => {
        await input.beforeSellerStart?.();
        sellerStartMock();
        return { id: "job_duplicate" };
      },
    );

    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow(SokoBotRuntimeConflictError);

    expect(transactionDelegationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          outcome: "failed",
          error: "old-attempt-fence",
        }),
      }),
    );
    expect(sellerStartMock).not.toHaveBeenCalled();
    expect(decisionUpdateManyMock).not.toHaveBeenCalled();
  });

  it("reserves job input before seller dispatch and never reopens afterward", async () => {
    decisionFindFirstMock.mockResolvedValue(provideInputDecision());
    jobEventFindFirstMock.mockResolvedValue({
      id: "event_1",
      input: null,
      inputSchema: { input_data: [] },
      job: {
        id: "job_1",
        agentJobId: "seller-job-1",
        agentBlockchainIdentifier: null,
        agentApiBaseUrl: null,
        agent: {
          id: "agent_1",
          name: "Agent",
          blockchainIdentifier: "seller-agent-1",
          apiBaseUrl: "https://agent.example.com",
          metadataOverride: null,
        },
      },
    });
    provideJobInputMock.mockRejectedValue(new Error("response lost"));

    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow("response lost");

    expect(delegationCreateMock.mock.invocationCallOrder[0]).toBeLessThan(
      provideJobInputMock.mock.invocationCallOrder[0] ?? 0,
    );
    expect(decisionUpdateManyMock).toHaveBeenCalledOnce();
    expect(decisionUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING" }),
      }),
    );
    expect(decisionUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "EXPIRED" }),
      }),
    );
  });

  it("reopens a hire only when seller start explicitly failed", async () => {
    createAgentJobForUserMock.mockImplementationOnce(
      async (input: {
        beforeSellerStart?: () => Promise<void>;
        afterSellerStartFailure?: (failure: {
          kind: "unreachable";
          message: string;
        }) => Promise<void>;
      }) => {
        await input.beforeSellerStart?.();
        await input.afterSellerStartFailure?.({
          kind: "unreachable",
          message: "Seller rejected before acceptance",
        });
        throw new Error("Seller rejected before acceptance");
      },
    );

    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow("Seller rejected before acceptance");

    expect(delegationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "failed" }),
      }),
    );
    expect(decisionUpdateManyMock).toHaveBeenLastCalledWith({
      where: { id: DECISION_ID, status: "PROCESSING" },
      data: { status: "PENDING", resolvedByUserId: null },
    });
  });

  it("keeps ambiguous seller starts fenced", async () => {
    createAgentJobForUserMock.mockImplementationOnce(
      async (input: {
        beforeSellerStart?: () => Promise<void>;
        afterSellerStartFailure?: (failure: {
          kind: "ambiguous";
          message: string;
        }) => Promise<void>;
      }) => {
        await input.beforeSellerStart?.();
        await input.afterSellerStartFailure?.({
          kind: "ambiguous",
          message: "Seller response lost",
        });
        throw new Error("Seller response lost");
      },
    );

    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow("Seller response lost");

    expect(delegationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ outcome: "ambiguous" }),
      }),
    );
    expect(decisionUpdateManyMock).toHaveBeenCalledOnce();
    expect(decisionUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "EXPIRED" }),
      }),
    );
  });
});

describe("SokoBotRuntimeService chat reading", () => {
  const SCOPE_TURN = {
    id: SCOPE.turnId,
    sokoBotId: SCOPE.sokoBotId,
    userId: SCOPE.userId,
    workspaceId: SCOPE.workspaceId,
    eveSessionId: SCOPE.sessionId,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: true });
    botFindUniqueMock.mockResolvedValue({ coworker: { id: "coworker_1" } });
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: "org_1" });
  });

  it("only lists rooms the bot is a member of", async () => {
    chatRoomFindManyMock.mockResolvedValue([]);

    await new SokoBotRuntimeService()["listChats"]({
      turn: SCOPE_TURN,
    } as never);

    const where = chatRoomFindManyMock.mock.calls[0][0].where;
    expect(where.coworkerMembers).toEqual({
      some: { coworkerId: "coworker_1" },
    });
    // Membership is the boundary; ChatRoom has no workspaceId column.
    expect(where.archivedAt).toBeNull();
  });

  it("refuses to read a room the bot does not belong to", async () => {
    // The model supplies the room id, so membership is re-checked per call.
    chatRoomFindFirstMock.mockResolvedValue(null);

    await expect(
      new SokoBotRuntimeService()["readChat"]({ turn: SCOPE_TURN } as never, {
        roomId: "01960001-0001-7001-8001-00000000dead",
      }),
    ).rejects.toThrow(/not a member/);
    expect(chatMessageFindManyMock).not.toHaveBeenCalled();
  });

  it("returns messages newest first and marks the bot's own", async () => {
    chatRoomFindFirstMock.mockResolvedValue({ id: "room_1", name: "Launch" });
    chatMessageFindManyMock.mockResolvedValue([
      {
        id: "m2",
        content: "on it",
        createdAt: new Date("2026-08-27T10:01:00.000Z"),
        senderUser: null,
        senderCoworker: { id: "coworker_1", name: "Soko Bot" },
      },
      {
        id: "m1",
        content: "can you check the launch date?",
        createdAt: new Date("2026-08-27T10:00:00.000Z"),
        senderUser: { name: "Patrick" },
        senderCoworker: null,
      },
    ]);

    const result = (await new SokoBotRuntimeService()["readChat"](
      { turn: SCOPE_TURN } as never,
      { roomId: "room_1" },
    )) as { messages: { from: string; fromYou: boolean }[] };

    expect(chatMessageFindManyMock.mock.calls[0][0].orderBy).toEqual({
      createdAt: "desc",
    });
    expect(chatMessageFindManyMock.mock.calls[0][0].where.deletedAt).toBeNull();
    expect(result.messages[0]).toMatchObject({
      from: "Soko Bot",
      fromYou: true,
    });
    expect(result.messages[1]).toMatchObject({
      from: "Patrick",
      fromYou: false,
    });
  });
});

describe("post_chat chain depth", () => {
  const SCOPE_TURN = {
    id: SCOPE.turnId,
    sokoBotId: SCOPE.sokoBotId,
    userId: SCOPE.userId,
    workspaceId: SCOPE.workspaceId,
    eveSessionId: SCOPE.sessionId,
  };

  function armPostChat(chainDepth: number) {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: true });
    botFindUniqueMock.mockResolvedValue({ coworker: { id: "cow_self" } });
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: "org_1" });
    chatRoomFindFirstMock.mockResolvedValue({
      id: "room_1",
      name: "Launch",
      kind: "channel",
    });
    // Where the chain was started, for the origin-room check on depth > 0.
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      chatMention: { message: { roomId: "room_1" } },
    });
    chatCoworkerMemberFindManyMock.mockResolvedValue([
      { coworker: { id: "cow_other", name: "Jarvis", slug: "jarvis" } },
    ]);
    chatMessageCountMock.mockResolvedValue(0);
    transactionChatMessageCreateMock.mockResolvedValue({
      id: "msg_1",
      createdAt: new Date("2026-08-29T10:00:00.000Z"),
    });
    transactionChatMentionCreateManyMock.mockResolvedValue({ count: 1 });
    mentionFindManyMock.mockResolvedValue([{ id: "mention_1" }]);
    dispatchChatRoomMentionMock.mockResolvedValue(undefined);
    transactionChatRoomUpdateMock.mockResolvedValue({});
    serializableTransactionMock.mockImplementation(
      async (run: (tx: unknown) => unknown) =>
        await run({
          chatRoomMessage: {
            create: transactionChatMessageCreateMock,
            count: chatMessageCountMock,
          },
          chatRoomMention: {
            createMany: transactionChatMentionCreateManyMock,
            findMany: mentionFindManyMock,
          },
          chatRoom: { update: transactionChatRoomUpdateMock },
        }),
    );
    return { turn: { ...SCOPE_TURN, chainDepth } } as never;
  }

  it("refuses an unattended post into a colleague's direct", async () => {
    // Nobody can leave a direct, so being in one must not become a standing
    // licence to write in it: one instruction to reach Nina would otherwise
    // let every later stand-up reach her again with nobody asking.
    armPostChat(0);
    chatRoomFindFirstMock.mockResolvedValue({
      id: "room_direct",
      name: "Nina",
      kind: "direct",
    });
    chatRoomUserMemberFindFirstMock.mockResolvedValue(null);

    await expect(
      new SokoBotRuntimeService()["postChat"](
        { turn: { ...SCOPE_TURN, source: "SCHEDULE", chainDepth: 0 } } as never,
        { roomId: "room_direct", content: "Morning, any update?" },
      ),
    ).rejects.toThrow(/turns your owner asked for/i);
    expect(transactionChatMessageCreateMock).not.toHaveBeenCalled();
  });

  it("still briefs the owner in their own direct unprompted", async () => {
    // The whole point of a scheduled turn, so the owner's room is exempt.
    armPostChat(0);
    chatRoomFindFirstMock.mockResolvedValue({
      id: "room_owner",
      name: "Ada",
      kind: "direct",
    });
    chatRoomUserMemberFindFirstMock.mockResolvedValue({ id: "member_1" });

    await new SokoBotRuntimeService()["postChat"](
      { turn: { ...SCOPE_TURN, source: "SCHEDULE", chainDepth: 0 } } as never,
      { roomId: "room_owner", content: "Here is your stand-up." },
    );

    expect(transactionChatMessageCreateMock).toHaveBeenCalled();
  });

  it("leaves channels alone on an unattended turn", async () => {
    // A person can leave or mute a channel, and a bot added to a project room
    // is expected to speak in it.
    armPostChat(0);
    chatRoomFindFirstMock.mockResolvedValue({
      id: "room_1",
      name: "Launch",
      kind: "channel",
    });

    await new SokoBotRuntimeService()["postChat"](
      { turn: { ...SCOPE_TURN, source: "SCHEDULE", chainDepth: 0 } } as never,
      { roomId: "room_1", content: "Nightly digest." },
    );

    expect(transactionChatMessageCreateMock).toHaveBeenCalled();
    expect(chatRoomUserMemberFindFirstMock).not.toHaveBeenCalled();
  });

  it("summons the bot it addresses, one hop deeper", async () => {
    const authorized = armPostChat(0);

    await new SokoBotRuntimeService()["postChat"](authorized, {
      roomId: "room_1",
      content: "@jarvis can you confirm the date?",
    });

    expect(transactionChatMentionCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ messageId: "msg_1", coworkerId: "cow_other", chainDepth: 1 }],
      }),
    );
    // Writing the row is not enough: reclaim only rescues `sent`, so a row
    // nobody dispatches stays `pending` for ever and the target never wakes.
    expect(dispatchChatRoomMentionMock).toHaveBeenCalledWith("mention_1");
  });

  it("stops summoning once the chain reaches its ceiling", async () => {
    // The message still posts — it simply stops being a summons, so an
    // unattended exchange between two bots cannot run for ever.
    const authorized = armPostChat(MAX_CHAT_CHAIN_DEPTH);

    const result = await new SokoBotRuntimeService()["postChat"](authorized, {
      roomId: "room_1",
      content: "@jarvis one more thing",
    });

    expect(transactionChatMessageCreateMock).toHaveBeenCalled();
    expect(transactionChatMentionCreateManyMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ summoned: 0 });
  });

  it("refuses to post once the room has had its hour's worth", async () => {
    // Independent of the hop counter on purpose: depth reasoning is pairwise,
    // so three bots in a triangle could defeat it.
    const authorized = armPostChat(0);
    chatMessageCountMock.mockResolvedValue(ROOM_BOT_MESSAGES_PER_HOUR);

    await expect(
      new SokoBotRuntimeService()["postChat"](authorized, {
        roomId: "room_1",
        content: "@jarvis still here?",
      }),
    ).rejects.toThrow(/rate limited/i);

    expect(transactionChatMessageCreateMock).not.toHaveBeenCalled();
  });

  it("tells the reader how far the chain has run", async () => {
    const authorized = armPostChat(1);
    chatMessageCountMock.mockResolvedValue(3);

    await new SokoBotRuntimeService()["postChat"](authorized, {
      roomId: "room_1",
      content: "@jarvis one detail",
    });

    expect(transactionChatMessageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          metadata: {
            soko_bot_chain: {
              depth: 2,
              max_depth: MAX_CHAT_CHAIN_DEPTH,
              room_messages_this_hour: 4,
              room_messages_per_hour: ROOM_BOT_MESSAGES_PER_HOUR,
            },
          },
        }),
      }),
    );
  });

  it("refuses to answer anywhere but the room it was asked in", async () => {
    // post_chat takes a room id from the caller, so without this the bot that
    // asked could name a room its own owner cannot see and have this bot post
    // — and summon coworkers — there on its behalf.
    const authorized = armPostChat(1);
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      chatMention: { message: { roomId: "room_asked_in" } },
    });

    await expect(
      new SokoBotRuntimeService()["postChat"](authorized, {
        roomId: "room_somewhere_else",
        content: "@jarvis look at this",
      }),
    ).rejects.toThrow(/only reply in the room you were asked in/i);

    expect(transactionChatMessageCreateMock).not.toHaveBeenCalled();
  });

  it("answers normally in the room it was asked in", async () => {
    const authorized = armPostChat(1);
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      chatMention: { message: { roomId: "room_1" } },
    });

    await new SokoBotRuntimeService()["postChat"](authorized, {
      roomId: "room_1",
      content: "@jarvis the date is confirmed",
    });

    expect(transactionChatMessageCreateMock).toHaveBeenCalled();
  });

  it("never summons itself", async () => {
    const authorized = armPostChat(0);
    chatCoworkerMemberFindManyMock.mockResolvedValue([]);

    await new SokoBotRuntimeService()["postChat"](authorized, {
      roomId: "room_1",
      content: "@jarvis and me",
    });

    expect(
      chatCoworkerMemberFindManyMock.mock.calls[0][0].where.coworkerId,
    ).toEqual({ not: "cow_self" });
    expect(transactionChatMentionCreateManyMock).not.toHaveBeenCalled();
  });
});

describe("open_direct_chat", () => {
  const SCOPE_TURN = {
    id: SCOPE.turnId,
    sokoBotId: SCOPE.sokoBotId,
    userId: SCOPE.userId,
    workspaceId: SCOPE.workspaceId,
    eveSessionId: SCOPE.sessionId,
    source: "CHAT",
    chainDepth: 0,
  };

  function arm() {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: true });
    toolCallCountMock.mockResolvedValue(0);
    botFindUniqueMock.mockResolvedValue({ coworker: { id: "cow_self" } });
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: "org_1" });
    memberFindManyMock.mockResolvedValue([
      { user: { id: "user_colleague", name: "Nina", email: "nina@x.io" } },
    ]);
    createOrGetDirectRoomMock.mockResolvedValue({
      room: { id: "room_new", name: "Nina" },
      created: true,
    });
    // The first message is posted as part of opening, so post_chat's own
    // dependencies have to be armed here too.
    chatRoomFindFirstMock.mockResolvedValue({ id: "room_new", name: "Nina" });
    chatRoomDeleteManyMock.mockResolvedValue({ count: 1 });
    chatMessageCountMock.mockResolvedValue(0);
    chatCoworkerMemberFindManyMock.mockResolvedValue([]);
    transactionChatMessageCreateMock.mockResolvedValue({
      id: "msg_1",
      createdAt: new Date("2026-08-30T10:00:00.000Z"),
    });
    transactionChatRoomUpdateMock.mockResolvedValue({});
    serializableTransactionMock.mockImplementation(
      async (run: (tx: unknown) => unknown) =>
        await run({
          chatRoomMessage: {
            create: transactionChatMessageCreateMock,
            count: chatMessageCountMock,
          },
          chatRoomMention: {
            createMany: transactionChatMentionCreateManyMock,
            findMany: mentionFindManyMock,
          },
          chatRoom: { update: transactionChatRoomUpdateMock },
        }),
    );
    return { turn: SCOPE_TURN } as never;
  }

  it("opens a direct with a colleague in the same organization", async () => {
    const authorized = arm();

    const result = await new SokoBotRuntimeService()["openDirectChat"](
      authorized,
      { person: "Nina", message: "Hi, I am Ana.", toolCallId: "call_1" },
    );

    expect(createOrGetDirectRoomMock).toHaveBeenCalledWith({
      organizationId: "org_1",
      currentUserId: "user_colleague",
      memberUserIds: [],
      coworkerIds: ["cow_self"],
      viewerUserId: null,
    });
    expect(result).toMatchObject({ roomId: "room_new", created: true });
    // The room and its first message land together: a room opened and never
    // written in is an empty conversation nobody can remove.
    expect(transactionChatMessageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "Hi, I am Ana." }),
      }),
    );
  });

  it("takes the room back down when the first message cannot be sent", async () => {
    // Half of this is worse than none: a room the colleague can never leave,
    // holding nothing that says who opened it or why.
    const authorized = arm();
    chatMessageCountMock.mockResolvedValue(ROOM_BOT_MESSAGES_PER_HOUR);

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](authorized, {
        person: "Nina",
        message: "Hi, I am Ana.",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/rate limited/i);

    // Conditioned on the room still being empty: postChat can fail after its
    // message commits, and an unconditional delete would take that message
    // — and any reply to it — with the room.
    expect(chatRoomDeleteManyMock).toHaveBeenCalledWith({
      where: { id: "room_new", messages: { none: {} } },
    });
  });

  it("leaves a room it did not open standing when the message fails", async () => {
    // The conversation predates this turn; deleting it would take somebody
    // else's history with it.
    const authorized = arm();
    createOrGetDirectRoomMock.mockResolvedValue({
      room: { id: "room_new", name: "Nina" },
      created: false,
    });
    chatMessageCountMock.mockResolvedValue(ROOM_BOT_MESSAGES_PER_HOUR);

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](authorized, {
        person: "Nina",
        message: "Hi, I am Ana.",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/rate limited/i);

    expect(chatRoomDeleteManyMock).not.toHaveBeenCalled();
  });

  it("does not let a wildcard stand in for a name", async () => {
    // `%` and `_` are wildcards in Prisma's startsWith, and this string comes
    // from a model reading untrusted text: unescaped, "%" alone would match a
    // colleague at random and open a permanent room with them.
    const authorized = arm();

    await new SokoBotRuntimeService()["openDirectChat"](authorized, {
      person: "%",
      message: "Hi",
      toolCallId: "call_1",
    });

    const where = memberFindManyMock.mock.calls[0]?.[0]?.where;
    const startsWith = where.user.OR[1].name.startsWith;
    expect(startsWith).toBe("\\% ");
  });

  it("matches an address against addresses, never a display name", async () => {
    // A member who sets their display name to counsel@outside.example would
    // otherwise be the match when the owner asks to contact counsel.
    const authorized = arm();

    await new SokoBotRuntimeService()["openDirectChat"](authorized, {
      person: "counsel@outside.example",
      message: "Hi",
      toolCallId: "call_1",
    });

    const where = memberFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where.user).toEqual({
      email: { equals: "counsel@outside.example", mode: "insensitive" },
    });
    expect(JSON.stringify(where.user)).not.toContain("name");
  });

  it("looks up an @handle as a name, never as an address", async () => {
    // The classifier routes "ping @ben" here, so this is the shape the model
    // passes on. Looked up as an address, "@ben" can only ever miss.
    const authorized = arm();

    await new SokoBotRuntimeService()["openDirectChat"](authorized, {
      person: "@ben",
      message: "Hi",
      toolCallId: "call_1",
    });

    const where = memberFindManyMock.mock.calls[0]?.[0]?.where;
    expect(where.user.OR[0].name.equals).toBe("ben");
    expect(JSON.stringify(where.user)).not.toContain("email");
  });

  it("refuses a target that is nothing but an @", async () => {
    // It passes the schema's min(1) and strips to an empty string, which
    // would match a member whose display name is blank.
    const authorized = arm();

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](authorized, {
        person: "@",
        message: "Hi",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/Name the person to write to/i);
    expect(memberFindManyMock).not.toHaveBeenCalled();
  });

  it("offers addresses when two names differ only in case", async () => {
    // Compared case-sensitively, "Nina" and "NINA" look like two usable
    // answers — and either one matches both people again, for ever.
    const authorized = arm();
    memberFindManyMock.mockResolvedValue([
      { user: { id: "u1", name: "Nina", email: "nina.a@x.io" } },
      { user: { id: "u2", name: "NINA", email: "nina.b@x.io" } },
    ]);

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](authorized, {
        person: "Nina",
        message: "Hi, I am Ana.",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/nina\.a@x\.io, nina\.b@x\.io/);
  });

  it("asks rather than guessing when a name matches two people", async () => {
    // Picking one would mean approaching the wrong colleague, in a room
    // neither of them can leave.
    const authorized = arm();
    memberFindManyMock.mockResolvedValue([
      { user: { id: "u1", name: "Nina Alvarez", email: "nina.a@x.io" } },
      { user: { id: "u2", name: "Nina Brown", email: "nina.b@x.io" } },
    ]);

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](authorized, {
        person: "Nina",
        message: "Hi, I am Ana.",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/Nina Alvarez, Nina Brown/);
    expect(createOrGetDirectRoomMock).not.toHaveBeenCalled();
  });

  it("falls back to addresses only when the names themselves collide", async () => {
    const authorized = arm();
    memberFindManyMock.mockResolvedValue([
      { user: { id: "u1", name: "Nina", email: "nina.a@x.io" } },
      { user: { id: "u2", name: "Nina", email: "nina.b@x.io" } },
    ]);

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](authorized, {
        person: "Nina",
        message: "Hi, I am Ana.",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/nina\.a@x\.io, nina\.b@x\.io/);
  });

  it("refuses on a turn the owner did not ask for", async () => {
    // Approaching a colleague unprompted puts the owner in front of someone
    // with nobody having asked; the bot can suggest it in their chat instead.
    const authorized = arm();
    const scheduled = {
      turn: { ...SCOPE_TURN, source: "SCHEDULE" },
    } as never;

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](scheduled, {
        person: "Nina",
        message: "Hi, I am Ana.",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/turns your owner asked for/i);
    void authorized;
    expect(createOrGetDirectRoomMock).not.toHaveBeenCalled();
  });

  it("refuses a turn another assistant asked for", async () => {
    const asked = {
      turn: { ...SCOPE_TURN, source: "CHAT", chainDepth: 1 },
    } as never;
    arm();

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](asked, {
        person: "Nina",
        message: "Hi, I am Ana.",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/turns your owner asked for/i);
    expect(createOrGetDirectRoomMock).not.toHaveBeenCalled();
  });

  it("stops one turn approaching the whole organization", async () => {
    // A turn may make 64 tool calls; without this one instruction could open
    // a direct with every member at once.
    const authorized = arm();
    toolCallCountMock.mockResolvedValue(5);

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](authorized, {
        person: "Nina",
        message: "Hi, I am Ana.",
        toolCallId: "call_6",
      }),
    ).rejects.toThrow(/at most 5 direct chats/i);
    expect(createOrGetDirectRoomMock).not.toHaveBeenCalled();
  });

  it("refuses someone outside the organization", async () => {
    // Otherwise a bot could start a conversation with anyone whose id it can
    // name, from a workspace they have nothing to do with.
    const authorized = arm();
    memberFindManyMock.mockResolvedValue([]);

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](authorized, {
        person: "Stranger",
        message: "Hi, I am Ana.",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/No member of this organization matches/i);
    expect(createOrGetDirectRoomMock).not.toHaveBeenCalled();
  });

  it("refuses when the workspace has no organization", async () => {
    const authorized = arm();
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: null });

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](authorized, {
        person: "Nina",
        message: "Hi, I am Ana.",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/need an organization workspace/i);
    expect(createOrGetDirectRoomMock).not.toHaveBeenCalled();
  });

  it("does not open a second room with its own owner", async () => {
    // The owner already has the bot's direct room; a second would split the
    // conversation in two.
    const authorized = arm();
    memberFindManyMock.mockResolvedValue([
      { user: { id: SCOPE.userId, name: "Owner", email: "owner@x.io" } },
    ]);

    await expect(
      new SokoBotRuntimeService()["openDirectChat"](authorized, {
        person: "Owner",
        message: "Hi, I am Ana.",
        toolCallId: "call_1",
      }),
    ).rejects.toThrow(/already have a direct chat with your owner/i);
    expect(createOrGetDirectRoomMock).not.toHaveBeenCalled();
  });
});
