import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  botFindFirstMock,
  botFindUniqueMock,
  chatRoomFindFirstMock,
  chatRoomDeleteManyMock,
  chatRoomUserMemberFindFirstMock,
  chatRoomUserMemberFindManyMock,
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
  agentFindFirstMock,
  taskFindFirstMock,
  taskFindManyMock,
  taskCountMock,
  taskGroupByMock,
  files,
  images,
  marketplace,
  jobFindFirstMock,
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
  transactionTaskEventFindManyMock,
  transactionTaskEventCreateMock,
  transactionTaskWatchUpsertMock,
  transactionWorkspaceFindFirstMock,
  transactionMock,
  turnFindUniqueMock,
  transactionChatMessageCreateMock,
  transactionChatMentionCreateManyMock,
  transactionChatRoomUpdateMock,
  chatCoworkerMemberFindManyMock,
  chatSokoBotMemberFindManyMock,
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
  applyGuardedTaskStatusUpdateMock,
  emitChatDirectMessageNotificationsMock,
  notifyTaskStatusEventMock,
  publishTaskEventDataMock,
  publishChatRoomMessageRealtimeByIdMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  botFindUniqueMock: vi.fn(),
  chatRoomFindFirstMock: vi.fn(),
  chatRoomDeleteManyMock: vi.fn(),
  chatRoomUserMemberFindFirstMock: vi.fn(),
  chatRoomUserMemberFindManyMock: vi.fn(),
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
  agentFindFirstMock: vi.fn(),
  taskFindFirstMock: vi.fn(),
  taskFindManyMock: vi.fn(),
  taskCountMock: vi.fn(),
  taskGroupByMock: vi.fn().mockResolvedValue([]),
  marketplace: { list: vi.fn(), rate: vi.fn() },
  images: {
    access: vi.fn(),
    create: vi.fn(),
    getJob: vi.fn(),
    reconcile: vi.fn(),
    credits: vi.fn(),
  },
  files: {
    list: vi.fn(),
    put: vi.fn(),
    head: vi.fn(),
    search: vi.fn(),
    loadLive: vi.fn(),
    adopt: vi.fn(),
    reserve: vi.fn(),
    activate: vi.fn(),
    nudge: vi.fn(),
    chunks: vi.fn(),
    download: vi.fn(),
  },
  jobFindFirstMock: vi.fn(),
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
  transactionTaskEventFindManyMock: vi.fn(),
  transactionTaskEventCreateMock: vi.fn(),
  transactionTaskWatchUpsertMock: vi.fn(),
  transactionWorkspaceFindFirstMock: vi.fn(),
  transactionMock: vi.fn(),
  turnFindUniqueMock: vi.fn(),
  transactionChatMessageCreateMock: vi.fn(),
  transactionChatMentionCreateManyMock: vi.fn(),
  transactionChatRoomUpdateMock: vi.fn(),
  chatCoworkerMemberFindManyMock: vi.fn(),
  chatSokoBotMemberFindManyMock: vi.fn(),
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
  applyGuardedTaskStatusUpdateMock: vi.fn(),
  emitChatDirectMessageNotificationsMock: vi.fn(),
  notifyTaskStatusEventMock: vi.fn(),
  publishTaskEventDataMock: vi.fn(),
  publishChatRoomMessageRealtimeByIdMock: vi.fn(),
}));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/services/soko-bot-availability.service", () => ({
  getSokoBotAvailability: availabilityMock,
}));
vi.mock("@/helpers/data-table", () => ({
  resolveTableActor: vi.fn(),
  createDataTable: vi.fn(),
  listDataTables: vi.fn(),
  requireDataTable: vi.fn(),
  queryTableRows: vi.fn(),
  batchTableRows: vi.fn(),
  mutateDataTable: vi.fn(),
}));

const social = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  publish: vi.fn(),
  beta: vi.fn(),
  seat: vi.fn(),
  owner: vi.fn(),
}));
vi.mock("@/services/project-social-connections.service", () => ({
  listProjectSocialConnections: social.listAccounts,
}));
vi.mock("@/services/social-posts.service", () => ({
  listSocialPosts: social.list,
  getSocialPost: social.get,
  createSocialPost: social.create,
  updateSocialPost: social.update,
  scheduleSocialPost: social.schedule,
  cancelSocialPost: social.cancel,
}));
vi.mock("@/services/social-post-publisher.service", () => ({
  publishSocialPostNow: social.publish,
}));
vi.mock("@/helpers/social-beta-access", () => ({
  requireSocialBetaAccess: social.beta,
}));
vi.mock("@/helpers/organization-assigned-seat", () => ({
  requireAssignedOrganizationSeat: social.seat,
}));

vi.mock("@vercel/blob", () => ({
  head: files.head,
  list: files.list,
  put: files.put,
}));
vi.mock("@/lib/soko-bot/agent-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/soko-bot/agent-search")>()),
  listHireableAgents: marketplace.list,
  rateAgentFit: marketplace.rate,
}));
vi.mock("@/lib/image-studio/catalog", () => ({
  imageModel: () => ({ id: "gemini-flash" }),
  resolveImageSettings: (_id: string, settings: unknown) => settings,
}));
vi.mock("@/lib/image-studio/fal-catalog-refresh", () => ({
  ensureImageCatalogFresh: vi.fn(),
}));
vi.mock("@/lib/image-studio/image-model", () => ({
  creditsPerImage: images.credits,
  IMAGE_ASPECT_RATIOS: ["1:1", "16:9"],
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: images.access,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  getJob: images.getJob,
}));
vi.mock("@/services/image-studio-jobs.service", () => ({
  createImageJob: images.create,
  reconcileProjectJobs: images.reconcile,
  DEFAULT_SETTINGS: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
}));
vi.mock("@/services/file-search.service", () => ({
  searchFiles: files.search,
  loadLiveResources: files.loadLive,
}));
vi.mock("@/services/file-backfill.service", () => ({
  adoptDriveStoreIfPending: files.adopt,
}));
vi.mock("@/services/file-catalog.service", () => ({
  reserveDriveUploadResource: files.reserve,
  activateDriveUploadResource: files.activate,
}));
vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileIndexing: files.nudge,
}));
vi.mock("@/services/file-index.service", () => ({
  downloadBlob: files.download,
}));
const { taskChargeEventsMock } = vi.hoisted(() => ({
  taskChargeEventsMock: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskEvent: { findMany: taskChargeEventsMock },
    fileChunk: { findMany: files.chunks },
    $transaction: transactionMock,
    user: { findUnique: social.owner },
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
    chatRoomUserMember: {
      findFirst: chatRoomUserMemberFindFirstMock,
      findMany: chatRoomUserMemberFindManyMock,
    },
    chatRoomMessage: {
      findMany: chatMessageFindManyMock,
      count: chatMessageCountMock,
    },
    chatRoomCoworkerMember: { findMany: chatCoworkerMemberFindManyMock },
    chatRoomSokoBotMember: {
      findMany: chatSokoBotMemberFindManyMock,
    },
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
      upsert: toolCallCreateMock,
      findUnique: toolCallFindUniqueMock,
      update: toolCallUpdateMock,
      updateMany: toolCallUpdateManyMock,
    },
    agent: { findFirst: agentFindFirstMock },
    task: {
      findFirst: taskFindFirstMock,
      findMany: taskFindManyMock,
      count: taskCountMock,
      groupBy: taskGroupByMock,
    },
    job: { findFirst: jobFindFirstMock },
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
          upsert: vi.fn().mockResolvedValue({}),
        },
        project: { findFirst: transactionProjectFindFirstMock },
        workspace: { findFirst: transactionWorkspaceFindFirstMock },
        sokoBotTurn: {
          findUnique: vi.fn().mockResolvedValue(null),
          findFirst: transactionTurnFindFirstMock,
          updateMany: transactionTurnUpdateManyMock,
        },
        task: {
          create: transactionTaskCreateMock,
          findFirst: transactionTaskFindFirstMock,
          update: transactionTaskUpdateMock,
        },
        taskEvent: {
          findMany: transactionTaskEventFindManyMock,
          create: transactionTaskEventCreateMock,
        },
        sokoBotTaskWatch: { upsert: transactionTaskWatchUpsertMock },
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
const { unreadCountsMock } = vi.hoisted(() => ({
  unreadCountsMock: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("@/routes/v1/chats/rooms/room-unread", () => ({
  getChatRoomUnreadCounts: unreadCountsMock,
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
  applyGuardedTaskStatusUpdate: applyGuardedTaskStatusUpdateMock,
}));
vi.mock("@/helpers/task-notifications", () => ({
  notifyTaskStatusEvent: notifyTaskStatusEventMock,
}));
vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: vi.fn(),
  publishTaskEventData: publishTaskEventDataMock,
}));
vi.mock("@/helpers/chat-direct-message-notifications", () => ({
  emitChatDirectMessageNotifications: emitChatDirectMessageNotificationsMock,
  shouldEmitChatDirectMessageNotifications: vi.fn(
    ({ kind, memberUserIds }) => kind === "direct" && memberUserIds.length <= 2,
  ),
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: publishChatRoomMessageRealtimeByIdMock,
}));
const { persistChatHumanMentionsMock, emitChatHumanMentionNotificationsMock } =
  vi.hoisted(() => ({
    persistChatHumanMentionsMock: vi.fn().mockResolvedValue([]),
    emitChatHumanMentionNotificationsMock: vi.fn().mockResolvedValue(undefined),
  }));
vi.mock("@/helpers/chat-human-mentions", () => ({
  persistChatHumanMentions: persistChatHumanMentionsMock,
  emitChatHumanMentionNotifications: emitChatHumanMentionNotificationsMock,
}));
vi.mock("@/helpers/task-link", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/task-link")>()),
  mapTaskLinkRelationToWriteData: vi.fn(),
}));
vi.mock("@sokosumi/masumi", () => ({
  createAgentClient: createAgentClientMock,
}));

import { buildSokoBotAudienceTaskVisibilityWhere } from "@/helpers/task-visibility";
import {
  MAX_CHAT_CHAIN_DEPTH,
  ROOM_BOT_MESSAGES_PER_HOUR,
} from "@/lib/soko-bot/chat-chain";
import {
  isSokoBotDecisionTargetAllowed,
  SokoBotRefusedUnsentError,
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
    transactionTaskEventFindManyMock.mockResolvedValue([]);
    transactionTaskEventCreateMock.mockResolvedValue({ id: "event_1" });
    transactionTaskWatchUpsertMock.mockResolvedValue({});
    applyGuardedTaskStatusUpdateMock.mockResolvedValue(undefined);
    emitChatDirectMessageNotificationsMock.mockResolvedValue(undefined);
    notifyTaskStatusEventMock.mockResolvedValue(undefined);
    publishTaskEventDataMock.mockResolvedValue(undefined);
    publishChatRoomMessageRealtimeByIdMock.mockResolvedValue(undefined);
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

  it.each(["create_task", "archive_task"] as const)(
    "independently rejects %s on a persisted memory-only grant",
    async (capability) => {
      turnFindUniqueMock.mockResolvedValue({
        userMessage: "Remember that I prefer short updates",
        id: SCOPE.turnId,
        sokoBotId: SCOPE.sokoBotId,
        userId: SCOPE.userId,
        workspaceId: SCOPE.workspaceId,
        capabilityNames: ["update_memory", "get_task_status"],
        contextSnapshot: {
          id: "01960001-0001-7001-8001-000000000004",
          packet: { memory: { version: 1 } },
        },
        eveSessionId: SCOPE.sessionId,
        status: "RUNNING",
        deadlineAt: new Date(Date.now() + 60_000),
        leaseExpiresAt: new Date(Date.now() + 60_000),
        sokoBot: { archivedAt: null, status: "RUNNING" },
      });
      await expect(
        new SokoBotRuntimeService().authorize({ ...SCOPE, capability }),
      ).rejects.toThrow("Capability is not granted for this turn");
      expect(transactionTaskCreateMock).not.toHaveBeenCalled();
      expect(transactionTaskUpdateMock).not.toHaveBeenCalled();
    },
  );

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
    expect(toolCallUpdateManyMock).toHaveBeenCalledTimes(2);

    // Another owner's assistant is named with its owner.
    taskFindFirstMock.mockResolvedValue({
      id: "task_1",
      name: "Launch",
      status: "READY",
      events: [
        {
          id: "event-1",
          status: null,
          comment: "Hold until Albina confirms the spend.",
          createdAt: new Date(0),
          coworkerId: null,
          userId: null,
          sokoBotId: "other-bot",
          sokoBot: { name: "Lili", user: { name: "Albina" } },
        },
      ],
      files: [],
      linksFrom: [],
      linksTo: [],
    });
    const read = await service["readTask"](
      {
        turn: { ...SCOPE, id: SCOPE.turnId },
        askedByKind: "OWNER",
      } as never,
      "task_1",
    );
    expect(read?.events[0]).toMatchObject({
      by: "another_bot",
      byName: "Lili, Albina's assistant",
    });
    expect(toolCallUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    );
  });

  it("hides private Tasks from teammate Soko Bot reads", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the tasks",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_task_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: {
          trigger: { askedBy: { kind: "TEAMMATE" } },
          memory: { version: 1 },
        },
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
      inputHash: createHash("sha256")
        .update(JSON.stringify({ taskId: "task_1" }))
        .digest("hex"),
      updatedAt: new Date(0),
    });
    toolCallUpdateManyMock.mockResolvedValue({ count: 1 });
    taskFindFirstMock.mockResolvedValue(null);

    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "get_task_status",
      toolCallId: "call_teammate_task",
      input: { taskId: "task_1" },
    });

    expect(result).toBeNull();
    expect(taskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "task_1",
          workspaceId: SCOPE.workspaceId,
          archivedAt: null,
          visibility: "PUBLIC",
        }),
      }),
    );
  });

  it.each(["OWNER", "TEAMMATE", "ASSISTANT"] as const)(
    "does not return PRIVATE peer links Alice cannot see from readTask (%s)",
    async (askedByKind) => {
      turnFindUniqueMock.mockResolvedValue({
        userMessage: "Check the tasks",
        id: SCOPE.turnId,
        sokoBotId: SCOPE.sokoBotId,
        userId: SCOPE.userId,
        workspaceId: SCOPE.workspaceId,
        capabilityNames: ["get_task_status"],
        contextSnapshot: {
          id: "01960001-0001-7001-8001-000000000004",
          packet: {
            trigger: { askedBy: { kind: askedByKind } },
            memory: { version: 1 },
          },
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
        inputHash: createHash("sha256")
          .update(JSON.stringify({ taskId: "public-1" }))
          .digest("hex"),
        updatedAt: new Date(0),
      });
      toolCallUpdateManyMock.mockResolvedValue({ count: 1 });
      const publicPeer = {
        id: "public-2",
        name: "Public sibling",
        status: "READY",
      };
      const secretPeer = {
        id: "secret-1",
        name: "Secret acquisition",
        status: "READY",
      };
      const visiblePeerTask = {
        workspaceId: SCOPE.workspaceId,
        archivedAt: null,
        ...buildSokoBotAudienceTaskVisibilityWhere(SCOPE.userId, askedByKind),
      };
      const visiblePeerWhere = { toTask: { is: visiblePeerTask } };
      const visibleFromPeerWhere = { fromTask: { is: visiblePeerTask } };
      taskFindFirstMock.mockImplementation(
        async (args: {
          select?: {
            linksFrom?: { where?: unknown };
            linksTo?: { where?: unknown };
          };
        }) => {
          const hidesPrivatePeers =
            isDeepStrictEqual(
              args.select?.linksFrom?.where,
              visiblePeerWhere,
            ) &&
            isDeepStrictEqual(
              args.select?.linksTo?.where,
              visibleFromPeerWhere,
            );
          return {
            id: "public-1",
            name: "Public launch",
            status: "READY",
            description: null,
            assignee: null,
            assigneeSokoBot: null,
            project: null,
            updatedAt: new Date("2026-09-16T12:00:00.000Z"),
            events: [],
            files: [],
            linksFrom: hidesPrivatePeers
              ? [{ type: "RELATED", note: null, toTask: publicPeer }]
              : [
                  { type: "RELATED", note: null, toTask: publicPeer },
                  { type: "RELATED", note: null, toTask: secretPeer },
                ],
            linksTo: [],
          };
        },
      );

      const result = await new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "get_task_status",
        toolCallId: `call_${askedByKind.toLowerCase()}_task_links`,
        input: { taskId: "public-1" },
      });

      expect(taskFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            linksFrom: expect.objectContaining({
              where: expect.objectContaining({
                toTask: expect.objectContaining({
                  is: expect.objectContaining(visiblePeerTask),
                }),
              }),
            }),
            linksTo: expect.objectContaining({
              where: expect.objectContaining({
                fromTask: expect.objectContaining({
                  is: expect.objectContaining(visiblePeerTask),
                }),
              }),
            }),
          }),
        }),
      );
      expect(result).toMatchObject({
        id: "public-1",
        links: [
          {
            relation: "RELATED",
            direction: "from-this",
            task: publicPeer,
            note: null,
          },
        ],
      });
      expect(JSON.stringify(result)).not.toContain("Secret acquisition");
      expect(JSON.stringify(result)).not.toContain("secret-1");
    },
  );

  it("lists the owner's open, idle, unassigned Tasks by the words asked for", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Which launch tasks are stuck?",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["list_tasks"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: { archivedAt: null, status: "RUNNING" },
    });
    // Keys in canonical order: the reuse check hashes the sorted input.
    const input = {
      assignee: "unassigned",
      idleDays: 3,
      query: "launch copy",
    };
    toolCallFindUniqueMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000010",
      status: "PENDING",
      capability: "list_tasks",
      inputHash: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
      updatedAt: new Date(0),
    });
    toolCallUpdateManyMock.mockResolvedValue({ count: 1 });
    const updatedAt = new Date(Date.now() - 5 * 86_400_000);
    taskFindManyMock.mockResolvedValue([
      {
        id: "task-1",
        name: "Launch announcement copy",
        status: "DRAFT",
        updatedAt,
        assignee: null,
        assigneeUser: null,
        assigneeSokoBot: null,
        project: null,
        events: [],
      },
    ]);
    taskCountMock.mockResolvedValue(1);
    // Two debits and a refund: only what was billed counts.
    taskChargeEventsMock.mockResolvedValueOnce([
      { taskId: "task-1", transaction: { amount: -4_000_000_000_000n } },
      { taskId: "task-1", transaction: { amount: -213_100_000_000n } },
    ]);

    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "list_tasks",
      toolCallId: "call_list_tasks",
      input,
    });

    expect(result).toEqual({
      tasks: [
        {
          id: "task-1",
          name: "Launch announcement copy",
          status: "DRAFT",
          assignee: null,
          project: null,
          idleDays: 5,
          updatedAt: updatedAt.toISOString(),
          creditsCharged: 421.31,
          latest: null,
        },
      ],
      total: 1,
      byStatus: {},
    });
    const { where } = taskFindManyMock.mock.calls[0][0];
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { workspaceId: SCOPE.workspaceId, archivedAt: null },
        { status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] } },
        { updatedAt: { lte: expect.any(Date) } },
        {
          OR: [
            { name: { contains: "launch", mode: "insensitive" } },
            { description: { contains: "launch", mode: "insensitive" } },
          ],
        },
        {
          OR: [
            { name: { contains: "copy", mode: "insensitive" } },
            { description: { contains: "copy", mode: "insensitive" } },
          ],
        },
        { assigneeId: null, assigneeUserId: null, assigneeSokoBotId: null },
      ]),
    );
    expect(taskCountMock).toHaveBeenCalledWith({ where });
  });

  it("filters by exact status and counts every match by status", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "What is stuck?",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["list_tasks"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: { archivedAt: null, status: "RUNNING" },
    });
    const input = { status: ["INPUT_REQUIRED", "FAILED"] };
    toolCallFindUniqueMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000011",
      status: "PENDING",
      capability: "list_tasks",
      inputHash: createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex"),
      updatedAt: new Date(0),
    });
    toolCallUpdateManyMock.mockResolvedValue({ count: 1 });
    taskFindManyMock.mockResolvedValue([]);
    taskCountMock.mockResolvedValue(8);
    taskGroupByMock.mockResolvedValueOnce([
      { status: "INPUT_REQUIRED", _count: { _all: 6 } },
      { status: "FAILED", _count: { _all: 2 } },
    ]);

    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "list_tasks",
      toolCallId: "call_list_stuck",
      input,
    });

    expect(result).toMatchObject({
      total: 8,
      byStatus: { INPUT_REQUIRED: 6, FAILED: 2 },
    });
    const { where } = taskFindManyMock.mock.calls[0][0];
    // FAILED is a finished status; the default "open" must not hide it.
    expect(where.AND).toContainEqual({
      status: { in: ["INPUT_REQUIRED", "FAILED"] },
    });
    expect(where.AND).not.toContainEqual({
      status: { notIn: ["COMPLETED", "FAILED", "CANCELED"] },
    });
  });

  it("lists only public Tasks for a teammate", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "What is open?",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["list_tasks"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: {
          trigger: { askedBy: { kind: "TEAMMATE" } },
          memory: { version: 1 },
        },
      },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: { archivedAt: null, status: "RUNNING" },
    });
    toolCallFindUniqueMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-000000000010",
      status: "PENDING",
      capability: "list_tasks",
      inputHash: createHash("sha256").update(JSON.stringify({})).digest("hex"),
      updatedAt: new Date(0),
    });
    toolCallUpdateManyMock.mockResolvedValue({ count: 1 });
    taskFindManyMock.mockResolvedValue([]);
    taskCountMock.mockResolvedValue(0);

    await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "list_tasks",
      toolCallId: "call_teammate_tasks",
      input: {},
    });

    expect(taskFindManyMock.mock.calls[0][0].where.AND).toContainEqual({
      visibility: "PUBLIC",
    });
  });

  it("hides jobs on private parent Tasks from teammate Soko Bot reads", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Check the jobs",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_job_status"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: {
          trigger: { askedBy: { kind: "TEAMMATE" } },
          memory: { version: 1 },
        },
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
      capability: "get_job_status",
      inputHash: createHash("sha256")
        .update(JSON.stringify({ jobId: "job_1" }))
        .digest("hex"),
      updatedAt: new Date(0),
    });
    toolCallUpdateManyMock.mockResolvedValue({ count: 1 });
    jobFindFirstMock.mockResolvedValue(null);

    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "get_job_status",
      toolCallId: "call_teammate_job",
      input: { jobId: "job_1" },
    });

    expect(result).toBeNull();
    expect(jobFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              id: "job_1",
              ownerId: SCOPE.userId,
              workspaceId: SCOPE.workspaceId,
            },
            {
              OR: [
                { taskId: null },
                { task: { is: { visibility: "PUBLIC" } } },
              ],
            },
          ],
        },
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
    const persisted =
      toolCallUpdateManyMock.mock.calls.at(-1)?.[0]?.data.result;
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
          creatorSokoBotId: SCOPE.sokoBotId,
          events: {
            create: expect.objectContaining({
              channel: "SOKOSUMI",
              sokoBotId: SCOPE.sokoBotId,
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

  it("clears a Task's assignee when asked to unassign it", async () => {
    turnFindUniqueMock.mockResolvedValue({
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
      userMessage: "Actually make it unassigned",
      classification: { confidence: 1 },
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: { archivedAt: null, status: "RUNNING" },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionTaskFindFirstMock.mockResolvedValue({
      id: "task_1",
      name: "Launch",
      description: null,
      ownerId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      status: TaskStatus.DRAFT,
      projectId: null,
      archivedAt: null,
      updatedAt: new Date("2026-09-30T10:00:00Z"),
      assigneeId: "coworker_1",
      assigneeSokoBotId: null,
      assigneeUserId: null,
      visibility: "WORKSPACE",
    });
    transactionTaskUpdateMock.mockResolvedValue({
      id: "task_1",
      name: "Launch",
      status: TaskStatus.DRAFT,
      assigneeId: null,
      projectId: null,
      archivedAt: null,
      updatedAt: new Date("2026-09-30T10:01:00Z"),
    });

    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "update_task",
      toolCallId: "call_unassign",
      input: { taskId: "task_1", unassign: true },
    });

    expect(result).toMatchObject({ id: "task_1", assigneeId: null });
    expect(transactionTaskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeId: null,
          assigneeSokoBotId: null,
          assigneeUserId: null,
        }),
      }),
    );
  });

  it("cancels one of the owner's Tasks with the comment as the reason", async () => {
    transactionTaskFindFirstMock.mockResolvedValue({
      id: "task_1",
      name: "Launch",
      status: TaskStatus.INPUT_REQUIRED,
      ownerId: SCOPE.userId,
      assigneeId: "coworker_1",
      assigneeSokoBotId: null,
    });

    const result = await new SokoBotRuntimeService()["replyToTask"](
      {
        turn: {
          id: SCOPE.turnId,
          sokoBotId: SCOPE.sokoBotId,
          userId: SCOPE.userId,
          workspaceId: SCOPE.workspaceId,
        },
      } as never,
      {
        taskId: "task_1",
        comment: "Owner no longer needs it",
        status: "CANCELED",
      },
      "call_cancel",
    );

    expect(result).toMatchObject({
      id: "task_1",
      status: TaskStatus.CANCELED,
      statusChanged: true,
    });
    expect(transactionTaskEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: TaskStatus.CANCELED,
        comment: "Owner no longer needs it",
      }),
      select: { id: true },
    });
    expect(applyGuardedTaskStatusUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "task_1",
        expectedStatus: TaskStatus.INPUT_REQUIRED,
        eventStatus: TaskStatus.CANCELED,
      }),
    );
  });

  it("does not cancel a Task someone else owns", async () => {
    transactionTaskFindFirstMock.mockResolvedValue({
      id: "task_1",
      name: "Launch",
      status: TaskStatus.READY,
      ownerId: "someone-else",
      assigneeId: "coworker_1",
      assigneeSokoBotId: null,
    });

    await expect(
      new SokoBotRuntimeService()["replyToTask"](
        {
          turn: {
            id: SCOPE.turnId,
            sokoBotId: SCOPE.sokoBotId,
            userId: SCOPE.userId,
            workspaceId: SCOPE.workspaceId,
          },
        } as never,
        { taskId: "task_1", comment: "Stop", status: "CANCELED" },
        "call_cancel_other",
      ),
    ).rejects.toThrow(/owner's own Tasks/);
    expect(applyGuardedTaskStatusUpdateMock).not.toHaveBeenCalled();
  });

  it("resumes its own assigned Task and fans out the soko bot event", async () => {
    transactionTaskFindFirstMock.mockResolvedValue({
      id: "task_1",
      name: "Launch",
      status: TaskStatus.INPUT_REQUIRED,
      ownerId: SCOPE.userId,
      assigneeId: null,
      assigneeSokoBotId: SCOPE.sokoBotId,
    });

    const result = await new SokoBotRuntimeService()["replyToTask"](
      {
        turn: {
          id: SCOPE.turnId,
          sokoBotId: SCOPE.sokoBotId,
          userId: SCOPE.userId,
          workspaceId: SCOPE.workspaceId,
        },
      } as never,
      { taskId: "task_1", comment: "Inputs received", status: "READY" },
      "call_reply",
    );

    expect(result).toMatchObject({ id: "task_1", status: "READY" });
    expect(transactionTaskEventCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        taskId: "task_1",
        status: TaskStatus.READY,
        sokoBotId: SCOPE.sokoBotId,
      }),
      select: { id: true },
    });
    expect(publishTaskEventDataMock).not.toHaveBeenCalled();
    expect(notifyTaskStatusEventMock).not.toHaveBeenCalled();
    expect(transactionToolCallUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          disposition: "APPLIED",
          verification: "LOCAL_TRANSACTION",
          effectEventId: "event_1",
        }),
      }),
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

    // The lookup no longer filters by status: a Task in the wrong state has
    // to be told apart from one that does not exist, or the bot is told its
    // own id is wrong and makes a duplicate.
    expect(transactionTaskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ status: expect.anything() }),
      }),
    );
  });

  it("says a Task is in the wrong state rather than calling it missing", async () => {
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "Assign it",
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
      classification: { confidence: 1 },
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: { archivedAt: null, status: "RUNNING" },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionTaskFindFirstMock.mockResolvedValue({
      id: "task_1",
      status: "FAILED",
      ownerId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
    });

    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "update_task",
        toolCallId: "call_state",
        input: { taskId: "task_1", name: "Changed" },
      }),
    ).rejects.toThrow(/FAILED/);
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

    expect(transactionTurnLockMock).toHaveBeenCalledTimes(3);
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
    transactionToolCallFindUniqueMock.mockResolvedValue(null);
    transactionTurnFindFirstMock.mockResolvedValue({ id: SCOPE.turnId });
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
            sokoBotToolCall: { upsert: typeof toolCallCreateMock };
            sokoBotDelegation: {
              updateMany: typeof localJobDelegationUpdateManyMock;
            };
          },
        ) => Promise<void>;
      }) => {
        await input.beforeSellerStart?.();
        const job = { id: "job_1" };
        await input.afterLocalJobCreate?.(job, {
          sokoBotToolCall: { upsert: toolCallCreateMock },
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

  it("retains UNKNOWN external receipts instead of dispatching again", async () => {
    transactionToolCallFindUniqueMock.mockResolvedValue({
      id: "uncertain",
      status: "PENDING",
      disposition: "UNKNOWN",
    });
    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
      ),
    ).rejects.toThrow("requires reconciliation");
    expect(transactionToolCallCreateMock).not.toHaveBeenCalled();
    expect(localJobDelegationUpdateManyMock).not.toHaveBeenCalled();
    expect(decisionUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING" }),
      }),
    );
  });

  it("cancelled confirmation turn blocks external reservation", async () => {
    transactionTurnFindFirstMock.mockImplementation(
      async (args: { where: { id: string } }) =>
        args.where.id === "confirmation" ? null : { id: SCOPE.turnId },
    );
    await expect(
      new SokoBotRuntimeService().resolveDecision(
        SCOPE.userId,
        DECISION_ID,
        true,
        true,
        "confirmation",
      ),
    ).rejects.toThrow("Confirmation turn is no longer writable");
    expect(transactionToolCallCreateMock).not.toHaveBeenCalled();
    expect(localJobDelegationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("reserves an approved hire before starting its Agent Job", async () => {
    const sellerStartMock = vi.fn();
    createAgentJobForUserMock.mockImplementationOnce(
      async (input: {
        beforeSellerStart?: () => Promise<void>;
        afterLocalJobCreate?: (
          job: { id: string },
          tx: {
            sokoBotToolCall: { upsert: typeof toolCallCreateMock };
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
          sokoBotToolCall: { upsert: toolCallCreateMock },
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
    expect(transactionToolCallCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          disposition: "UNKNOWN",
          verification: "NONE",
        }),
      }),
    );
    expect(
      transactionToolCallCreateMock.mock.invocationCallOrder[0],
    ).toBeLessThan(sellerStartMock.mock.invocationCallOrder[0] ?? 0);
    expect(toolCallCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          disposition: "APPLIED",
          verification: "PROVIDER_ACK",
          targetId: "job_1",
        }),
      }),
    );

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

    // Status is enforced after the lookup, not inside it — see the update
    // case above for why conflating the two misled the bot.
    expect(transactionTaskFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.not.objectContaining({ status: expect.anything() }),
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

      expect(transactionToolCallCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            disposition: "UNKNOWN",
            verification: "NONE",
          }),
        }),
      );
      expect(
        transactionToolCallCreateMock.mock.invocationCallOrder[0],
      ).toBeLessThan(provideJobInputMock.mock.invocationCallOrder[0] ?? 0);
      if (kind === "unreachable") {
        expect(toolCallUpdateManyMock).toHaveBeenCalledWith(
          expect.objectContaining({
            data: {
              status: "FAILED",
              disposition: "REJECTED",
              verification: "NONE",
            },
          }),
        );
      } else {
        expect(toolCallUpdateManyMock).not.toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ disposition: "REJECTED" }),
          }),
        );
      }
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
    workspaceFindUniqueMock.mockResolvedValue({ organizationId: "org_1" });
  });

  it("only lists rooms the bot is a member of", async () => {
    chatRoomFindManyMock.mockResolvedValue([]);

    await new SokoBotRuntimeService()["listChats"]({
      turn: SCOPE_TURN,
    } as never);

    const where = chatRoomFindManyMock.mock.calls[0][0].where;
    expect(where.sokoBotMembers).toEqual({
      some: { sokoBotId: SCOPE.sokoBotId },
    });
    // Membership is the boundary; ChatRoom has no workspaceId column.
    expect(where.archivedAt).toBeNull();
  });

  it("lists a named group by its Group name", async () => {
    chatRoomFindManyMock.mockResolvedValue([
      {
        id: "room_1",
        name: "Ada, Ben",
        groupName: "Launch crew",
        kind: "direct",
        updatedAt: new Date("2026-09-23T10:00:00.000Z"),
        _count: { messages: 3 },
      },
      {
        id: "room_2",
        name: "Ada, Cara",
        groupName: null,
        kind: "direct",
        updatedAt: new Date("2026-09-23T09:00:00.000Z"),
        _count: { messages: 1 },
      },
    ]);

    const result = await new SokoBotRuntimeService()["listChats"]({
      turn: SCOPE_TURN,
    } as never);

    expect(result.rooms.map((room) => room.name)).toEqual([
      "Launch crew",
      "Ada, Cara",
    ]);
  });

  it("lists the owner's unread chats on an owner turn, including rooms the bot is not in", async () => {
    // First query: the bot's own rooms. Second: every room of the owner's.
    chatRoomFindManyMock
      .mockResolvedValueOnce([
        {
          id: "room_dm",
          name: "Joseph",
          groupName: null,
          kind: "direct",
          updatedAt: new Date("2026-09-30T10:00:00.000Z"),
          _count: { messages: 9 },
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "room_dm",
          name: "Joseph",
          groupName: null,
          kind: "direct",
          sokoBotMembers: [{ sokoBotId: SCOPE.sokoBotId }],
          userMembers: [{ mutedAt: null }],
        },
        {
          id: "room_marketing",
          name: "Marketing",
          groupName: null,
          kind: "channel",
          sokoBotMembers: [],
          userMembers: [{ mutedAt: new Date("2026-09-01T00:00:00.000Z") }],
        },
        {
          id: "room_read",
          name: "Design",
          groupName: null,
          kind: "channel",
          sokoBotMembers: [],
          userMembers: [{ mutedAt: null }],
        },
      ]);
    unreadCountsMock.mockResolvedValue(
      new Map([
        ["room_dm", { channel: 2, thread: 1, total: 3 }],
        ["room_marketing", { channel: 5, thread: 0, total: 5 }],
      ]),
    );

    const owner = await new SokoBotRuntimeService()["listChats"]({
      turn: SCOPE_TURN,
      askedByKind: "OWNER",
    } as never);
    expect(chatRoomFindManyMock.mock.calls[1][0].where).toEqual({
      archivedAt: null,
      organizationId: "org_1",
      userMembers: { some: { userId: SCOPE.userId } },
    });
    expect(unreadCountsMock).toHaveBeenCalledWith(
      ["room_dm", "room_marketing", "room_read"],
      SCOPE.userId,
      expect.anything(),
    );
    expect(owner.ownerUnread).toEqual([
      {
        roomId: "room_dm",
        name: "Joseph",
        kind: "direct",
        unread: 3,
        youAreMember: true,
      },
      {
        roomId: "room_marketing",
        name: "Marketing",
        kind: "channel",
        unread: 5,
        youAreMember: false,
        muted: true,
      },
    ]);

    chatRoomFindManyMock.mockResolvedValue([]);
    const teammate = await new SokoBotRuntimeService()["listChats"]({
      turn: SCOPE_TURN,
      askedByKind: "TEAMMATE",
    } as never);
    expect("ownerUnread" in teammate).toBe(false);
  });

  it("names a read group by its Group name", async () => {
    chatRoomFindFirstMock.mockResolvedValue({
      id: "room_1",
      name: "Ada, Ben",
      groupName: "Launch crew",
    });
    chatMessageFindManyMock.mockResolvedValue([]);

    const result = await new SokoBotRuntimeService()["readChat"](
      { turn: SCOPE_TURN } as never,
      { roomId: "room_1" },
    );

    expect(result.name).toBe("Launch crew");
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
        senderCoworker: null,
        senderSokoBot: { id: SCOPE.sokoBotId, name: "Soko Bot" },
      },
      {
        id: "m1",
        content: "can you check the launch date?",
        createdAt: new Date("2026-08-27T10:00:00.000Z"),
        senderUser: { name: "Patrick" },
        senderCoworker: null,
        senderSokoBot: null,
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

  it("labels an unnamed bot sender as Soko Bot and keeps unknown when there is no sender", async () => {
    chatRoomFindFirstMock.mockResolvedValue({ id: "room_1", name: "Launch" });
    chatMessageFindManyMock.mockResolvedValue([
      {
        id: "m-bot",
        content: "on it",
        createdAt: new Date("2026-08-27T10:01:00.000Z"),
        senderUser: null,
        senderCoworker: null,
        senderSokoBot: { id: SCOPE.sokoBotId, name: null },
      },
      {
        id: "m-none",
        content: "system",
        createdAt: new Date("2026-08-27T10:00:00.000Z"),
        senderUser: null,
        senderCoworker: null,
        senderSokoBot: null,
      },
    ]);

    const result = (await new SokoBotRuntimeService()["readChat"](
      { turn: SCOPE_TURN } as never,
      { roomId: "room_1" },
    )) as { messages: { from: string; fromYou: boolean }[] };

    expect(result.messages[0]).toMatchObject({
      from: "Soko Bot",
      fromYou: true,
    });
    expect(result.messages[1]).toMatchObject({
      from: "unknown",
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
    chatSokoBotMemberFindManyMock.mockResolvedValue([]);
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
          $queryRaw: vi.fn().mockResolvedValue([]),
          sokoBotTurn: {
            findFirst: vi.fn().mockResolvedValue({ id: SCOPE.turnId }),
            findUnique: turnFindUniqueMock,
          },
          workspace: {
            findFirst: vi.fn().mockResolvedValue({ id: SCOPE.workspaceId }),
            findUnique: workspaceFindUniqueMock,
          },
          member: { findFirst: vi.fn().mockResolvedValue({ id: "member" }) },
          sokoBotToolCall: {
            update: vi
              .fn()
              .mockResolvedValue({ id: "receipt", capability: "post_chat" }),
          },
          sokoBotEffectOutbox: {
            upsert: vi.fn().mockResolvedValue({ id: "effect" }),
          },
          chatRoomCoworkerMember: { findMany: chatCoworkerMemberFindManyMock },
          chatRoomSokoBotMember: { findMany: chatSokoBotMemberFindManyMock },
          chatRoomUserMember: { findFirst: chatRoomUserMemberFindFirstMock },
          chatRoomMessage: {
            create: transactionChatMessageCreateMock,
            count: chatMessageCountMock,
          },
          chatRoomMention: {
            createMany: transactionChatMentionCreateManyMock,
            findMany: mentionFindManyMock,
          },
          chatRoom: {
            update: transactionChatRoomUpdateMock,
            findFirst: chatRoomFindFirstMock,
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              userMembers: [{ userId: SCOPE.userId }],
              coworkerMembers: [],
              sokoBotMembers: [{ sokoBotId: SCOPE.sokoBotId }],
            }),
          },
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
        {
          roomId: "room_direct",
          content: "Morning, any update?",
          toolCallId: "call_1",
        },
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
    chatRoomUserMemberFindManyMock.mockResolvedValue([
      { userId: SCOPE.userId },
    ]);

    await new SokoBotRuntimeService()["postChat"](
      { turn: { ...SCOPE_TURN, source: "SCHEDULE", chainDepth: 0 } } as never,
      {
        roomId: "room_owner",
        content: "Here is your stand-up.",
        toolCallId: "call_1",
      },
    );

    expect(transactionChatMessageCreateMock).toHaveBeenCalled();
    expect(emitChatDirectMessageNotificationsMock).not.toHaveBeenCalled();
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
      { roomId: "room_1", content: "Nightly digest.", toolCallId: "call_1" },
    );

    expect(transactionChatMessageCreateMock).toHaveBeenCalled();
    expect(chatRoomUserMemberFindFirstMock).not.toHaveBeenCalled();
  });

  it("stages the addressed bot one hop deeper until private publication", async () => {
    const authorized = armPostChat(0);

    await new SokoBotRuntimeService()["postChat"](authorized, {
      toolCallId: "call_1",
      roomId: "room_1",
      content: "@jarvis can you confirm the date?",
    });

    expect(transactionChatMentionCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          {
            messageId: "msg_1",
            coworkerId: "cow_other",
            sokoBotId: null,
            chainDepth: 1,
            status: "staged",
          },
        ],
      }),
    );
    // Only the audience-checked outbox may activate and dispatch this mention.
    expect(dispatchChatRoomMentionMock).not.toHaveBeenCalled();
  });

  it("leaves human mentions hidden until audience-checked activation", async () => {
    const authorized = armPostChat(0);
    await new SokoBotRuntimeService()["postChat"](authorized, {
      toolCallId: "call_1",
      roomId: "room_1",
      content: "@user_owner the date is confirmed",
    });
    expect(persistChatHumanMentionsMock).not.toHaveBeenCalled();
    expect(emitChatHumanMentionNotificationsMock).not.toHaveBeenCalled();
  });

  it("stops summoning once the chain reaches its ceiling", async () => {
    // The message still posts — it simply stops being a summons, so an
    // unattended exchange between two bots cannot run for ever.
    const authorized = armPostChat(MAX_CHAT_CHAIN_DEPTH);

    const result = await new SokoBotRuntimeService()["postChat"](authorized, {
      toolCallId: "call_1",
      roomId: "room_1",
      content: "@jarvis one more thing",
    });

    expect(transactionChatMessageCreateMock).toHaveBeenCalled();
    expect(transactionChatMentionCreateManyMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      queuedMentions: 0,
      deliveryStatus: "QUEUED",
    });
  });

  it("refuses to post once the room has had its hour's worth", async () => {
    // Independent of the hop counter on purpose: depth reasoning is pairwise,
    // so three bots in a triangle could defeat it.
    const authorized = armPostChat(0);
    chatMessageCountMock.mockResolvedValue(ROOM_BOT_MESSAGES_PER_HOUR);

    await expect(
      new SokoBotRuntimeService()["postChat"](authorized, {
        toolCallId: "call_1",
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
      toolCallId: "call_1",
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
        toolCallId: "call_1",
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
      toolCallId: "call_1",
      roomId: "room_1",
      content: "@jarvis the date is confirmed",
    });

    expect(transactionChatMessageCreateMock).toHaveBeenCalled();
  });

  it("never summons itself", async () => {
    const authorized = armPostChat(0);
    chatCoworkerMemberFindManyMock.mockResolvedValue([]);

    await new SokoBotRuntimeService()["postChat"](authorized, {
      toolCallId: "call_1",
      roomId: "room_1",
      content: "@jarvis and me",
    });

    expect(
      chatSokoBotMemberFindManyMock.mock.calls[0][0].where.sokoBotId,
    ).toEqual({ not: SCOPE.sokoBotId });
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
    chatSokoBotMemberFindManyMock.mockResolvedValue([]);
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
          $queryRaw: vi.fn().mockResolvedValue([]),
          sokoBotTurn: {
            findFirst: vi.fn().mockResolvedValue({ id: SCOPE.turnId }),
            findUnique: turnFindUniqueMock,
          },
          workspace: {
            findFirst: vi.fn().mockResolvedValue({ id: SCOPE.workspaceId }),
            findUnique: workspaceFindUniqueMock,
          },
          member: { findFirst: vi.fn().mockResolvedValue({ id: "member" }) },
          sokoBotToolCall: {
            update: vi
              .fn()
              .mockResolvedValue({ id: "receipt", capability: "post_chat" }),
          },
          sokoBotEffectOutbox: {
            upsert: vi.fn().mockResolvedValue({ id: "effect" }),
          },
          chatRoomCoworkerMember: { findMany: chatCoworkerMemberFindManyMock },
          chatRoomSokoBotMember: { findMany: chatSokoBotMemberFindManyMock },
          chatRoomUserMember: { findFirst: chatRoomUserMemberFindFirstMock },
          chatRoomMessage: {
            create: transactionChatMessageCreateMock,
            count: chatMessageCountMock,
          },
          chatRoomMention: {
            createMany: transactionChatMentionCreateManyMock,
            findMany: mentionFindManyMock,
          },
          chatRoom: {
            update: transactionChatRoomUpdateMock,
            findFirst: chatRoomFindFirstMock,
            findUniqueOrThrow: vi.fn().mockResolvedValue({
              userMembers: [{ userId: SCOPE.userId }],
              coworkerMembers: [],
              sokoBotMembers: [{ sokoBotId: SCOPE.sokoBotId }],
            }),
          },
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
      coworkerIds: [],
      sokoBotIds: [SCOPE.sokoBotId],
      sokoBotActorUserId: SCOPE.userId,
      viewerUserId: null,
      transaction: expect.any(Object),
    });
    expect(result).toMatchObject({ roomId: "room_new", created: true });
    // The room and its queued message land together, but content stays hidden
    // until the outbox rechecks the exact audience.
    expect(transactionChatMessageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "",
          deletedAt: expect.any(Date),
        }),
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
    expect(chatRoomDeleteManyMock).not.toHaveBeenCalled();
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

describe("get_agent_input_schema", () => {
  function armTurn() {
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
    turnFindUniqueMock.mockResolvedValue({
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["get_agent_input_schema"],
      contextSnapshot: {
        id: "01960001-0001-7001-8001-000000000004",
        packet: { memory: { version: 1 } },
      },
      eveSessionId: SCOPE.sessionId,
      userMessage: "What does this agent need?",
      classification: { confidence: 1 },
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: { archivedAt: null, status: "RUNNING" },
    });
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallCountMock.mockResolvedValue(0);
    transactionToolCallCreateMock.mockResolvedValue({});
    // Re-armed rather than inherited: the describes above replace this with
    // their own chat-shaped transaction, and clearAllMocks drops the
    // implementation the module mock installed.
    serializableTransactionMock.mockImplementation(
      async (run: (tx: unknown) => unknown) =>
        await run({
          $queryRaw: transactionTurnLockMock,
          sokoBotToolCall: {
            count: transactionToolCallCountMock,
            create: transactionToolCallCreateMock,
            findUnique: transactionToolCallFindUniqueMock,
            update: transactionToolCallUpdateMock,
            upsert: vi.fn().mockResolvedValue({}),
          },
        }),
    );
  }

  function ask(toolCallId: string) {
    return new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "get_agent_input_schema",
      toolCallId,
      input: { agentId: "01960001-0001-7001-8001-0000000000aa" },
    });
  }

  it("says an Agent is offline rather than missing", async () => {
    // The bot had the id right; being told "not found" sent it hunting for
    // another one instead of picking a different Agent.
    armTurn();
    agentFindFirstMock.mockResolvedValue({
      id: "01960001-0001-7001-8001-0000000000aa",
      name: "Offline Agent",
      status: "OFFLINE",
      blockchainIdentifier: null,
      apiBaseUrl: "https://agent.example.com",
      metadataOverride: null,
    });

    await expect(ask("call_offline_agent")).rejects.toThrow(
      /not available to hire right now \(offline\)/i,
    );
  });

  it("keeps an unlisted Agent hidden instead of confirming it exists", async () => {
    // `isShown` stays in the query, so a bot holding a stray UUID cannot use
    // this tool to enumerate rows `find_agents` deliberately does not return.
    armTurn();
    agentFindFirstMock.mockResolvedValue(null);

    await expect(ask("call_hidden_agent")).rejects.toThrow("Agent not found");
    expect(agentFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isShown: true }),
      }),
    );
  });
});

describe("external effect receipt finalization", () => {
  const proposal = { filename: "synthetic.md", content: "Synthetic content" };
  const inputHash = createHash("sha256")
    .update(canonicalJson(proposal))
    .digest("hex");

  function prepare() {
    vi.clearAllMocks();
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallCountMock.mockResolvedValue(0);
    toolCallUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
    const mutationTurn = vi.fn().mockResolvedValue({ id: SCOPE.turnId });
    serializableTransactionMock.mockImplementation(async (operation) =>
      operation({
        $queryRaw: transactionTurnLockMock,
        sokoBotTurn: { findFirst: mutationTurn },
        workspace: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: SCOPE.workspaceId, organizationId: null }),
        },
        sokoBotToolCall: {
          findUnique: transactionToolCallFindUniqueMock,
          count: transactionToolCallCountMock,
          create: transactionToolCallCreateMock,
          updateMany: toolCallUpdateManyMock,
        },
      }),
    );
    const service = new SokoBotRuntimeService();
    service.authorize = vi.fn().mockResolvedValue({
      turn: {
        id: SCOPE.turnId,
        sokoBotId: SCOPE.sokoBotId,
        userId: SCOPE.userId,
        workspaceId: SCOPE.workspaceId,
      },
    });
    const dispatch = vi.fn().mockResolvedValue({
      id: "01a0f400-0000-7000-8000-000000000001",
      filename: "synthetic.md",
      link: "/drive/files/01a0f400-0000-7000-8000-000000000001",
      size: 17,
    });
    service["executeAuthorizedTool"] = dispatch;
    return { service, dispatch, mutationTurn };
  }

  it("records uncertainty before dispatch and a specific provider acknowledgment afterward", async () => {
    const { service, dispatch } = prepare();
    await service.executeTool({
      ...SCOPE,
      capability: "upload_file",
      toolCallId: "external-one",
      input: proposal,
    });
    expect(toolCallUpdateManyMock.mock.calls[0][0].data).toEqual({
      disposition: "UNKNOWN",
      verification: "NONE",
    });
    expect(toolCallUpdateManyMock.mock.invocationCallOrder[0]).toBeLessThan(
      dispatch.mock.invocationCallOrder[0],
    );
    expect(toolCallUpdateManyMock.mock.calls[1][0].data).toMatchObject({
      status: "COMPLETED",
      disposition: "APPLIED",
      verification: "PROVIDER_ACK",
      targetId: "01a0f400-0000-7000-8000-000000000001",
    });
  });

  it("never dispatches after transactional authority is revoked", async () => {
    const { service, dispatch, mutationTurn } = prepare();
    mutationTurn.mockResolvedValue(null);
    await expect(
      service.executeTool({
        ...SCOPE,
        capability: "upload_file",
        toolCallId: "revoked",
        input: proposal,
      }),
    ).rejects.toThrow("no longer writable");
    expect(dispatch).not.toHaveBeenCalled();
    expect(toolCallUpdateManyMock).not.toHaveBeenCalled();
  });

  it("never dispatches without a reserved row", async () => {
    const { service, dispatch } = prepare();
    toolCallUpdateManyMock.mockResolvedValueOnce({ count: 0 });
    await expect(
      service.executeTool({
        ...SCOPE,
        capability: "upload_file",
        toolCallId: "external-one",
        input: proposal,
      }),
    ).rejects.toThrow("reservation is unavailable");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches stale same-turn semantic retries with the canonical receipt call id", async () => {
    const { service, dispatch } = prepare();
    const localInput = { taskId: "task-one", name: "Synthetic task" };
    const localHash = createHash("sha256")
      .update(canonicalJson(localInput))
      .digest("hex");
    toolCallFindUniqueMock.mockResolvedValueOnce(null);
    transactionToolCallFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "receipt-one",
        turnId: SCOPE.turnId,
        toolCallId: "canonical-call",
        capability: "update_task",
        inputHash: localHash,
        status: "PENDING",
        updatedAt: new Date(0),
      });
    await service.executeTool({
      ...SCOPE,
      capability: "update_task",
      toolCallId: "retry-call",
      input: localInput,
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: "canonical-call" }),
    );
    expect(toolCallUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          turnId: SCOPE.turnId,
          toolCallId: "canonical-call",
          status: "PENDING",
        },
      }),
    );
  });

  it("links a semantic replay to the original receipt without copying execution proof", async () => {
    const { service, dispatch } = prepare();
    transactionToolCallFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "original-receipt",
        turnId: "previous-turn",
        toolCallId: "original-call",
        capability: "upload_file",
        inputHash,
        status: "COMPLETED",
        disposition: "APPLIED",
        result: { url: "https://blob.example/synthetic" },
      });
    await service.executeTool({
      ...SCOPE,
      capability: "upload_file",
      toolCallId: "replayed-call",
      input: { content: proposal.content, filename: proposal.filename },
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(toolCallCreateMock).toHaveBeenCalledWith({
      where: {
        turnId_toolCallId: {
          turnId: SCOPE.turnId,
          toolCallId: "replayed-call",
        },
      },
      create: expect.objectContaining({
        replayedReceiptId: "original-receipt",
        disposition: "ALREADY_SATISFIED",
        verification: "NONE",
        status: "COMPLETED",
      }),
      update: {},
    });
    expect(toolCallCreateMock.mock.calls[0][0].create).not.toHaveProperty(
      "committedAt",
    );
    expect(toolCallCreateMock.mock.calls[0][0].create).not.toHaveProperty(
      "operationKey",
    );
  });

  it("does not move a stale prior-turn receipt into a new turn", async () => {
    const { service, dispatch } = prepare();
    toolCallFindUniqueMock.mockResolvedValueOnce({
      id: "receipt-one",
      turnId: "previous-turn",
      toolCallId: "canonical-call",
      capability: "update_task",
      inputHash,
      status: "PENDING",
      updatedAt: new Date(0),
    });
    await expect(
      service.executeTool({
        ...SCOPE,
        capability: "update_task",
        toolCallId: "retry-call",
        input: proposal,
      }),
    ).rejects.toThrow("Previous-turn operation requires reconciliation");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("marks stale external reservations unknown and never repeats the effect", async () => {
    const { service, dispatch } = prepare();
    toolCallFindUniqueMock.mockResolvedValue({
      id: "receipt-one",
      status: "PENDING",
      capability: "upload_file",
      inputHash,
      updatedAt: new Date(0),
    });
    await expect(
      service.executeTool({
        ...SCOPE,
        capability: "upload_file",
        toolCallId: "external-one",
        input: proposal,
      }),
    ).rejects.toThrow("reconciliation");
    expect(dispatch).not.toHaveBeenCalled();
    expect(toolCallUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: "FAILED",
          disposition: "UNKNOWN",
          verification: "NONE",
        },
      }),
    );
  });

  it("preserves uncertainty after a timeout, including a retry with a completed decision marker", async () => {
    const { service, dispatch } = prepare();
    dispatch.mockRejectedValueOnce(new Error("Timed out after send"));
    await expect(
      service.executeTool({
        ...SCOPE,
        capability: "upload_file",
        toolCallId: "external-one",
        input: proposal,
      }),
    ).rejects.toThrow("Timed out");
    expect(toolCallUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          disposition: "UNKNOWN",
        }),
      }),
    );
    toolCallFindUniqueMock.mockResolvedValueOnce({
      id: "receipt-one",
      status: "COMPLETED",
      disposition: "UNKNOWN",
      capability: "upload_file",
      inputHash,
    });
    await expect(
      service.executeTool({
        ...SCOPE,
        capability: "upload_file",
        toolCallId: "external-one",
        input: proposal,
      }),
    ).rejects.toThrow("reconciliation");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("records a refusal before anything was sent as rejected, not unknown", async () => {
    const { service, dispatch } = prepare();
    dispatch.mockRejectedValueOnce(
      new SokoBotRefusedUnsentError('A file named "notes.md" already exists.'),
    );
    await expect(
      service.executeTool({
        ...SCOPE,
        capability: "upload_file",
        toolCallId: "external-one",
        input: proposal,
      }),
    ).rejects.toThrow("already exists");
    expect(toolCallUpdateManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          disposition: "REJECTED",
        }),
      }),
    );
  });
});

describe("Soko Bot project social tools", () => {
  const projectId = "01960001-0001-7001-8001-000000000011";
  const postId = "01960001-0001-7001-8001-000000000012";
  const accountId = "01960001-0001-7001-8001-000000000013";
  const capabilities = [
    "list_project_social_accounts",
    "list_social_posts",
    "get_social_post",
    "create_social_post",
    "update_social_post",
    "schedule_social_post",
    "cancel_social_post",
    "publish_social_post",
  ];
  const post = {
    id: postId,
    projectId,
    provider: "x",
    text: "Launch",
    media: [],
    status: "DRAFT",
    scheduledAt: null,
    timezone: null,
    socialConnection: {
      id: accountId,
      externalHandle: "launch",
      displayName: null,
      avatarUrl: null,
      status: "active",
    },
    creator: { kind: "sokoBot", id: SCOPE.sokoBotId, name: "Lili" },
    scheduledByUserId: null,
    scheduledByCoworkerId: null,
    canceledAt: null,
    publishedAt: null,
    publishedExternalId: null,
    publishedUrl: null,
    lastError: null,
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastAttempt: null,
    revision: 2,
    createdAt: "2026-09-28T12:00:00Z",
    updatedAt: "2026-09-28T12:00:00Z",
    canEdit: true,
    canSchedule: true,
    canCancel: true,
    canPublishNow: true,
    connectionNeedsReconnect: false,
  };
  const tx = {
    $queryRaw: transactionTurnLockMock,
    user: { findUnique: social.owner },
    workspace: { findFirst: transactionWorkspaceFindFirstMock },
    sokoBotTurn: {
      findFirst: transactionTurnFindFirstMock,
      findUnique: vi.fn().mockResolvedValue(null),
    },
    sokoBotToolCall: {
      findUnique: transactionToolCallFindUniqueMock,
      count: transactionToolCallCountMock,
      create: transactionToolCallCreateMock,
      update: transactionToolCallUpdateMock,
      updateMany: toolCallUpdateManyMock,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const mock of Object.values(social)) mock.mockReset();
    availabilityMock.mockResolvedValue({ disabled: false });
    getEnvMock.mockReturnValue({ SOKO_BOT_ENABLED: true });
    social.owner.mockResolvedValue({ banned: false, banExpires: null });
    social.beta.mockResolvedValue(undefined);
    social.seat.mockResolvedValue(undefined);
    social.listAccounts.mockResolvedValue([
      {
        id: accountId,
        provider: "youtube",
        externalHandle: "Launch channel",
        displayName: "Launch channel",
        avatarUrl: null,
        status: "active",
        connectedAt: "2026-09-28T12:00:00Z",
        disconnectedAt: null,
      },
    ]);
    social.list.mockResolvedValue({
      posts: [post],
      pagination: { hasMore: false },
    });
    for (const mock of [
      social.get,
      social.create,
      social.update,
      social.schedule,
      social.cancel,
    ])
      mock.mockResolvedValue(post);
    social.publish.mockResolvedValue({
      ...post,
      status: "PUBLISHED",
      publishedExternalId: "x-post-1",
      publishedUrl: "https://x.com/launch/status/1",
    });
    workspaceFindFirstMock.mockResolvedValue({
      id: SCOPE.workspaceId,
      organizationId: "organization-one",
    });
    transactionWorkspaceFindFirstMock.mockResolvedValue({
      id: SCOPE.workspaceId,
      organizationId: "organization-one",
    });
    transactionTurnFindFirstMock.mockResolvedValue({ id: SCOPE.turnId });
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallCountMock.mockResolvedValue(0);
    transactionToolCallUpdateMock.mockResolvedValue({});
    toolCallUpdateManyMock.mockResolvedValue({ count: 1 });
    serializableTransactionMock.mockImplementation(async (operation) =>
      operation(tx),
    );
    turnFindUniqueMock.mockResolvedValue({
      ...SCOPE,
      id: SCOPE.turnId,
      eveSessionId: SCOPE.sessionId,
      source: "CHAT",
      chainDepth: 0,
      capabilityNames: capabilities,
      contextSnapshot: {
        id: "snapshot",
        packet: {
          memory: { version: 1 },
          trigger: { askedBy: { kind: "OWNER" } },
        },
      },
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: { archivedAt: null, adminPausedAt: null, status: "RUNNING" },
    });
  });

  it("lists actual account metadata scoped to the authorized workspace", async () => {
    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "list_project_social_accounts",
      toolCallId: "accounts",
      input: { projectId },
    });
    expect(social.listAccounts).toHaveBeenCalledWith({
      projectId,
      workspaceId: SCOPE.workspaceId,
    });
    expect(result).toEqual([
      expect.objectContaining({
        provider: "youtube",
        externalHandle: "Launch channel",
      }),
    ]);
    expect(social.beta).toHaveBeenCalledWith(SCOPE.userId, expect.anything());
    expect(social.seat).toHaveBeenCalledWith(
      SCOPE.userId,
      "organization-one",
      expect.anything(),
    );
  });

  it("forwards status filters, cursor, and page size without changing workspace", async () => {
    await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "list_social_posts",
      toolCallId: "list",
      input: {
        projectId,
        statuses: ["SCHEDULED", "FAILED"],
        cursor: postId,
        limit: 5,
      },
    });
    expect(social.list).toHaveBeenCalledWith({
      projectId,
      workspaceId: SCOPE.workspaceId,
      statuses: ["SCHEDULED", "FAILED"],
      cursor: postId,
      limit: 5,
    });
  });

  it("gets a post in the named project and current workspace", async () => {
    await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "get_social_post",
      toolCallId: "get",
      input: { projectId, postId },
    });
    expect(social.get).toHaveBeenCalledWith({
      projectId,
      postId,
      workspaceId: SCOPE.workspaceId,
    });
  });

  it.each(["beta", "seat"] as const)(
    "rejects reads when %s access is revoked",
    async (guard) => {
      social[guard].mockRejectedValue(new Error("Access revoked"));
      await expect(
        new SokoBotRuntimeService().executeTool({
          ...SCOPE,
          capability: "list_project_social_accounts",
          toolCallId: "denied",
          input: { projectId },
        }),
      ).rejects.toThrow("Access revoked");
      expect(social.listAccounts).not.toHaveBeenCalled();
    },
  );

  it("rejects banned owners before reading accounts", async () => {
    social.owner.mockResolvedValue({ banned: true, banExpires: null });
    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "list_project_social_accounts",
        toolCallId: "banned",
        input: { projectId },
      }),
    ).rejects.toThrow("no longer active");
    expect(social.listAccounts).not.toHaveBeenCalled();
  });

  it("does not allow model input to override the workspace", async () => {
    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "list_project_social_accounts",
        toolCallId: "override",
        input: { projectId, workspaceId: "another-workspace" },
      }),
    ).rejects.toThrow();
    expect(social.listAccounts).not.toHaveBeenCalled();
  });

  it("records bot authorship and the receipt in the mutation transaction", async () => {
    await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "create_social_post",
      toolCallId: "create",
      input: {
        projectId,
        text: "Launch",
        socialConnectionId: accountId,
        scheduledAt: "2026-10-01T14:00:00+02:00",
        timezone: "Europe/Prague",
      },
    });
    expect(social.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId,
        workspaceId: SCOPE.workspaceId,
        userId: SCOPE.userId,
        sokoBotId: SCOPE.sokoBotId,
        organizationId: "organization-one",
        scheduledAt: new Date("2026-10-01T12:00:00Z"),
        timezone: "Europe/Prague",
      }),
      tx,
    );
    expect(transactionToolCallUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          verification: "LOCAL_TRANSACTION",
          targetId: postId,
          actorBotId: SCOPE.sokoBotId,
          observedVersion: "2",
        }),
      }),
    );
  });

  it.each([
    [
      "update_social_post",
      "update",
      { projectId, postId, text: "Changed", revision: 2 },
    ],
    [
      "schedule_social_post",
      "schedule",
      { projectId, postId, scheduledAt: "2026-10-01T12:00:00Z", revision: 2 },
    ],
    ["cancel_social_post", "cancel", { projectId, postId, revision: 2 }],
  ] as const)(
    "%s delegates validation and revision checks to the existing service",
    async (capability, mock, input) => {
      await new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability,
        toolCallId: capability,
        input,
      });
      expect(social[mock]).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId,
          postId,
          revision: 2,
          workspaceId: SCOPE.workspaceId,
          userId: SCOPE.userId,
        }),
        tx,
      );
    },
  );

  it("does not report success when the observed revision is stale", async () => {
    social.update.mockRejectedValue(new Error("Revision conflict"));
    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "update_social_post",
        toolCallId: "conflict",
        input: { projectId, postId, revision: 1, text: "Changed" },
      }),
    ).rejects.toThrow("Revision conflict");
    expect(transactionToolCallUpdateMock).not.toHaveBeenCalled();
  });

  it("rechecks cancellation before committing a social mutation", async () => {
    transactionTurnFindFirstMock.mockResolvedValue(null);
    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "cancel_social_post",
        toolCallId: "revoked",
        input: { projectId, postId, revision: 2 },
      }),
    ).rejects.toThrow("no longer writable");
    expect(social.cancel).not.toHaveBeenCalled();
  });

  it("replays a completed create without creating a duplicate", async () => {
    const input = { projectId, text: "Launch" };
    toolCallFindUniqueMock.mockResolvedValue({
      inputHash: createHash("sha256")
        .update(canonicalJson(input))
        .digest("hex"),
      capability: "create_social_post",
      status: "COMPLETED",
      disposition: "APPLIED",
      result: post,
      toolCallId: "created",
      turnId: SCOPE.turnId,
    });
    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "create_social_post",
      toolCallId: "created",
      input,
    });
    expect(result).toEqual(post);
    expect(social.create).not.toHaveBeenCalled();
  });

  it("rechecks social access instead of replaying stale account data", async () => {
    const input = { projectId };
    toolCallFindUniqueMock.mockResolvedValue({
      inputHash: createHash("sha256")
        .update(canonicalJson(input))
        .digest("hex"),
      capability: "list_project_social_accounts",
      status: "COMPLETED",
      result: [{ provider: "youtube", externalHandle: "Old channel" }],
    });
    social.beta.mockRejectedValue(new Error("Social access revoked"));
    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "list_project_social_accounts",
        toolCallId: "accounts-replay",
        input,
      }),
    ).rejects.toThrow("Social access revoked");
    expect(social.listAccounts).not.toHaveBeenCalled();
  });

  it("persists refreshed read evidence when replaying a social lookup", async () => {
    const input = { projectId, postId };
    toolCallFindUniqueMock.mockResolvedValue({
      inputHash: createHash("sha256")
        .update(canonicalJson(input))
        .digest("hex"),
      capability: "get_social_post",
      status: "COMPLETED",
      result: { ...post, revision: 1 },
    });
    const result = await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "get_social_post",
      toolCallId: "refreshed-read",
      input,
    });
    expect(result).toMatchObject({ revision: 2 });
    expect(toolCallUpdateManyMock).toHaveBeenCalledWith({
      where: {
        turnId: SCOPE.turnId,
        toolCallId: "refreshed-read",
        status: "COMPLETED",
      },
      data: { result },
    });
  });

  it("does not expose a completed mutation's result after social access is revoked", async () => {
    const input = { projectId, text: "Launch" };
    toolCallFindUniqueMock.mockResolvedValue({
      inputHash: createHash("sha256")
        .update(canonicalJson(input))
        .digest("hex"),
      capability: "create_social_post",
      status: "COMPLETED",
      disposition: "APPLIED",
      result: post,
    });
    social.beta.mockRejectedValue(new Error("Social access revoked"));
    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "create_social_post",
        toolCallId: "created",
        input,
      }),
    ).rejects.toThrow("Social access revoked");
    expect(social.create).not.toHaveBeenCalled();
  });

  it("fences publish retries and records only provider-confirmed publication", async () => {
    await new SokoBotRuntimeService().executeTool({
      ...SCOPE,
      capability: "publish_social_post",
      toolCallId: "publish",
      input: { projectId, postId, revision: 2 },
    });
    expect(social.publish).toHaveBeenCalledWith({
      projectId,
      postId,
      revision: 2,
      workspaceId: SCOPE.workspaceId,
      userId: SCOPE.userId,
    });
    expect(toolCallUpdateManyMock.mock.calls[0][0].data).toMatchObject({
      disposition: "UNKNOWN",
    });
    expect(toolCallUpdateManyMock.mock.calls.at(-1)?.[0].data).toMatchObject({
      disposition: "APPLIED",
      verification: "PROVIDER_ACK",
      targetId: postId,
    });
  });

  it("will not retry an uncertain publish", async () => {
    const input = { projectId, postId, revision: 2 };
    toolCallFindUniqueMock.mockResolvedValue({
      inputHash: createHash("sha256")
        .update(canonicalJson(input))
        .digest("hex"),
      capability: "publish_social_post",
      disposition: "UNKNOWN",
    });
    await expect(
      new SokoBotRuntimeService().executeTool({
        ...SCOPE,
        capability: "publish_social_post",
        toolCallId: "publish",
        input,
      }),
    ).rejects.toThrow("reconciliation");
    expect(social.publish).not.toHaveBeenCalled();
  });
});

describe("Drive file tools", () => {
  const authorized = {
    turn: { userId: SCOPE.userId, workspaceId: SCOPE.workspaceId },
  };
  const service = new SokoBotRuntimeService();
  beforeEach(() => {
    workspaceFindUniqueMock.mockResolvedValue({
      id: "personal-workspace",
      organizationId: null,
    });
    files.adopt.mockResolvedValue({ ran: false });
  });

  it("searches the catalog as the owner's bot", async () => {
    files.search.mockResolvedValue({
      items: [
        {
          id: "file-1",
          displayName: "launch-notes.md",
          mimeType: "text/markdown",
          sizeBytes: 42,
          updatedAt: "2026-09-28T10:00:00.000Z",
          category: { displayName: "Planning" },
          tags: [{ displayName: "Launch" }],
          folderPath: "Marketing",
          snippet: { text: "Launch on the 15th" },
          extractionState: "SUCCEEDED",
        },
      ],
    });
    const result = await service["listFiles"](authorized as never, {
      query: "launch",
    });
    expect(files.search).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "personal-workspace",
        actor: { userId: SCOPE.userId, organizationId: null, kind: "soko_bot" },
        query: "launch",
        sortBy: "relevance",
      }),
    );
    expect(result).toEqual({
      files: [
        {
          id: "file-1",
          name: "launch-notes.md",
          type: "text/markdown",
          size: 42,
          updatedAt: "2026-09-28T10:00:00.000Z",
          category: "Planning",
          tags: ["Launch"],
          folder: "Marketing",
          passage: "Launch on the 15th",
          extraction: "SUCCEEDED",
        },
      ],
    });
  });

  it("reads a file's extracted text, and explains when there is none", async () => {
    files.loadLive.mockResolvedValueOnce([
      {
        id: "file-1",
        displayName: "brief.md",
        mimeType: "text/markdown",
        contentRevision: 2,
        extractionState: "SUCCEEDED",
        extractionReason: null,
      },
    ]);
    files.chunks.mockResolvedValueOnce([{ text: "One" }, { text: "Two" }]);
    await expect(
      service["readFile"](authorized as never, { fileId: "file-1" }),
    ).resolves.toMatchObject({ text: "One\n\nTwo", truncated: false });
    expect(files.chunks).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { version: { resourceId: "file-1", revision: 2 } },
      }),
    );

    files.loadLive.mockResolvedValueOnce([
      {
        id: "file-2",
        displayName: "scan.png",
        mimeType: "image/png",
        contentRevision: 1,
        extractionState: "PENDING",
        extractionReason: null,
      },
    ]);
    files.chunks.mockResolvedValueOnce([]);
    await expect(
      service["readFile"](authorized as never, { fileId: "file-2" }),
    ).resolves.toMatchObject({
      text: "",
      note: "The file is still being processed; its text is not ready yet.",
    });

    files.loadLive.mockResolvedValueOnce([]);
    await expect(
      service["readFile"](authorized as never, { fileId: "someone-elses" }),
    ).rejects.toThrow("File not found");
  });

  it("waits out the 404 a just-rewritten file gives", async () => {
    vi.useFakeTimers();
    files.loadLive.mockResolvedValueOnce([
      {
        id: "file-4",
        displayName: "notes.md",
        mimeType: "text/markdown",
        sizeBytes: 5,
        sourceKind: "DRIVE_UPLOAD",
        sourceId: "drive/users/u/notes.md",
        contentRevision: 1,
        extractionState: "RUNNING",
        extractionReason: null,
      },
    ]);
    files.chunks.mockResolvedValueOnce([]);
    files.download
      .mockReset()
      .mockRejectedValueOnce(new Error("Blob download failed with status 404"))
      .mockResolvedValueOnce(new TextEncoder().encode("hello"));
    const read = service["readFile"](authorized as never, { fileId: "file-4" });
    await vi.runAllTimersAsync();
    await expect(read).resolves.toMatchObject({ text: "hello" });
    expect(files.download).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("reads a Drive text file itself while search has not indexed it", async () => {
    const notes = {
      id: "file-3",
      displayName: "launch-notes.md",
      mimeType: "text/markdown",
      sizeBytes: 20,
      sourceKind: "DRIVE_UPLOAD",
      sourceId: "drive/users/u/launch-notes.md",
      contentRevision: 1,
      extractionState: "RUNNING",
      extractionReason: null,
    };
    files.loadLive.mockResolvedValueOnce([notes]);
    files.chunks.mockResolvedValueOnce([]);
    files.download.mockResolvedValueOnce(new TextEncoder().encode("# Launch"));
    await expect(
      service["readFile"](authorized as never, { fileId: "file-3" }),
    ).resolves.toMatchObject({
      text: "# Launch",
      note: "Read from the file itself; search has not indexed it yet.",
    });
    expect(files.download).toHaveBeenCalledWith(
      "drive/users/u/launch-notes.md",
    );

    // Not a Drive text file: nothing is downloaded.
    files.loadLive.mockResolvedValueOnce([
      { ...notes, mimeType: "application/pdf" },
    ]);
    files.chunks.mockResolvedValueOnce([]);
    files.download.mockClear();
    await service["readFile"](authorized as never, { fileId: "file-3" });
    expect(files.download).not.toHaveBeenCalled();
  });

  it("uploads through the catalog so the file is searchable", async () => {
    files.list.mockResolvedValue({ blobs: [] });
    files.put.mockResolvedValue({ url: "https://blob.example/notes.md" });
    files.reserve.mockResolvedValue({ resourceId: "file-9", versionId: "v1" });
    files.activate.mockResolvedValue({ resourceId: "file-9" });
    const result = await service["uploadFile"](authorized as never, {
      filename: "notes.md",
      content: "Hello",
    });
    expect(files.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      files.put.mock.invocationCallOrder[0],
    );
    expect(files.activate).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({
          workspaceId: "personal-workspace",
          scope: "user",
          ownerId: SCOPE.userId,
        }),
        sizeBytes: 5,
      }),
    );
    expect(files.nudge).toHaveBeenCalled();
    expect(result).toMatchObject({
      id: "file-9",
      link: "/drive/files/file-9",
      savedTo: "Files in the owner's personal workspace",
    });
    // The public blob URL would let anyone read the file without signing in.
    expect(JSON.stringify(result)).not.toContain("blob.example");
  });

  it("replaces an existing text file only when asked to", async () => {
    const existing = {
      pathname: "",
      url: "https://blob.example/notes.md",
    };
    files.list.mockImplementation(async ({ prefix }: { prefix: string }) => ({
      blobs: [{ ...existing, pathname: prefix }],
    }));
    files.head.mockResolvedValue({ contentType: "text/markdown" });
    files.put.mockResolvedValue({ url: "https://blob.example/notes.md" });
    files.reserve.mockResolvedValue({ resourceId: "file-9", versionId: "v2" });
    files.activate.mockResolvedValue({ resourceId: "file-9" });

    const refused = service["uploadFile"](authorized as never, {
      filename: "notes.md",
      content: "Hello again",
    });
    await expect(refused).rejects.toBeInstanceOf(SokoBotRefusedUnsentError);
    await expect(refused).rejects.toThrow("overwrite: true");
    expect(files.put).not.toHaveBeenCalled();

    const result = await service["uploadFile"](authorized as never, {
      filename: "notes.md",
      content: "Hello again",
      overwrite: true,
    });
    expect(files.put).toHaveBeenCalledWith(
      expect.any(String),
      "Hello again",
      expect.objectContaining({ allowOverwrite: true }),
    );
    expect(result).toMatchObject({
      id: "file-9",
      replaced: true,
      link: "/drive/files/file-9",
    });

    // A file that is not text is never replaced by text.
    files.put.mockClear();
    files.head.mockResolvedValue({ contentType: "application/pdf" });
    await expect(
      service["uploadFile"](authorized as never, {
        filename: "notes.md",
        content: "Hello again",
        overwrite: true,
      }),
    ).rejects.toThrow("not a text file");
    expect(files.put).not.toHaveBeenCalled();
    files.list.mockReset();
  });

  it("writes into the organization Drive the owner sees in an organization workspace", async () => {
    workspaceFindUniqueMock.mockResolvedValue({
      id: SCOPE.workspaceId,
      organizationId: "org-1",
    });
    files.list.mockResolvedValue({ blobs: [] });
    files.put.mockResolvedValue({ url: "https://blob.example/notes.md" });
    files.reserve.mockResolvedValue({ resourceId: "file-9", versionId: "v1" });
    files.activate.mockResolvedValue({ resourceId: "file-9" });
    const result = await service["uploadFile"](authorized as never, {
      filename: "notes.md",
      content: "Hello",
    });
    const pathname = files.put.mock.calls.at(-1)?.[0] as string;
    expect(pathname).toContain("org-1");
    expect(pathname).not.toContain(SCOPE.userId);
    expect(files.activate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({
          workspaceId: SCOPE.workspaceId,
          scope: "organization",
          ownerId: "org-1",
          pathname,
        }),
      }),
    );
    expect(result).toMatchObject({
      savedTo: "Files in this organization's workspace, visible to its members",
    });
  });
});

describe("Content Studio image tools", () => {
  const ownerChat = {
    askedByKind: "OWNER",
    turn: {
      id: SCOPE.turnId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      source: "CHAT",
      chainDepth: 0,
    },
  };
  const service = new SokoBotRuntimeService();
  const generate = (authorized: unknown, input: unknown, callId: string) =>
    service["generateImage"](authorized as never, input, callId);
  const request = {
    projectId: "project-1",
    prompt: "A calm launch banner",
    maxCredits: 10,
  };
  beforeEach(() => {
    images.credits.mockReturnValue(4);
    images.access.mockResolvedValue({ organizationId: null });
    toolCallCountMock.mockResolvedValue(0);
  });

  it("stops a turn after four images, counting only ones not refused", async () => {
    toolCallCountMock.mockResolvedValue(4);
    await expect(generate(ownerChat, request, "call-9")).rejects.toThrow(
      "at most 4 images",
    );
    expect(toolCallCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        turnId: SCOPE.turnId,
        capability: "generate_image",
        NOT: { toolCallId: "call-9" },
      }),
    });
    expect(images.create).not.toHaveBeenCalled();
  });

  it("starts an image within the price and links to the studio", async () => {
    images.create.mockResolvedValue({ id: "job-1", status: "QUEUED" });
    const result = await generate(ownerChat, request, "call-1");
    expect(images.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        workspaceId: SCOPE.workspaceId,
        userId: SCOPE.userId,
        prompt: "A calm launch banner",
        idempotencyKey: `soko-bot:${SCOPE.turnId}:call-1`,
      }),
    );
    expect(result).toMatchObject({
      jobId: "job-1",
      status: "QUEUED",
      credits: 4,
      studioUrl: "/studio?projectId=project-1",
    });
  });

  it("declines an image that costs more than it may spend", async () => {
    images.credits.mockReturnValue(25);
    await expect(generate(ownerChat, request, "call-2")).rejects.toThrow(
      "costs 25 credits, more than the 10 allowed",
    );
    expect(images.create).not.toHaveBeenCalled();
  });

  it("declines a Project the owner cannot open, and an unknown ratio", async () => {
    const { HTTPException } = await import("hono/http-exception");
    images.access.mockRejectedValueOnce(new HTTPException(404));
    await expect(generate(ownerChat, request, "call-5")).rejects.toThrow(
      "not one your owner can open",
    );
    await expect(
      generate(ownerChat, { ...request, aspectRatio: "7:3" }, "call-6"),
    ).rejects.toThrow("Use one of these aspect ratios: 1:1, 16:9");
    expect(images.create).not.toHaveBeenCalled();
  });

  it.each([
    ["a scheduled turn", { turn: { ...ownerChat.turn, source: "SCHEDULE" } }],
    ["a teammate", { askedByKind: "TEAMMATE" }],
    ["another bot", { turn: { ...ownerChat.turn, chainDepth: 1 } }],
  ])("refuses to spend for %s", async (_label, override) => {
    await expect(
      generate({ ...ownerChat, ...override }, request, "call-3"),
    ).rejects.toThrow("only when your owner asks in chat");
    expect(images.create).not.toHaveBeenCalled();
  });

  it("passes the studio's refusal to the model in its own words", async () => {
    const { HTTPException } = await import("hono/http-exception");
    images.create.mockRejectedValue(
      new HTTPException(422, { message: "Not enough credits for this image." }),
    );
    await expect(generate(ownerChat, request, "call-4")).rejects.toThrow(
      "Not enough credits for this image.",
    );
  });

  it("reports a finished image, checking access before the provider", async () => {
    images.getJob.mockResolvedValue({
      id: "job-1",
      status: "SUCCEEDED",
      assetId: "asset-7",
      failureReason: null,
    });
    await expect(
      service["getImage"](ownerChat as never, {
        projectId: "project-1",
        jobId: "job-1",
      }),
    ).resolves.toEqual({
      jobId: "job-1",
      status: "SUCCEEDED",
      failureReason: null,
      studioUrl: "/studio?projectId=project-1&v=asset-7",
    });
    expect(images.access.mock.invocationCallOrder[0]).toBeLessThan(
      images.reconcile.mock.invocationCallOrder[0],
    );
  });

  it("returns nothing for a job that is not in the Project", async () => {
    images.getJob.mockResolvedValue(null);
    await expect(
      service["getImage"](ownerChat as never, {
        projectId: "project-1",
        jobId: "missing",
      }),
    ).resolves.toBeNull();
  });

  it("records a studio refusal after the reservation as rejected", async () => {
    const { HTTPException } = await import("hono/http-exception");
    images.create.mockRejectedValue(
      new HTTPException(422, { message: "Not enough credits for this image." }),
    );
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallCountMock.mockResolvedValue(0);
    toolCallUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
    serializableTransactionMock.mockImplementation(async (operation) =>
      operation({
        $queryRaw: transactionTurnLockMock,
        sokoBotTurn: {
          findFirst: vi.fn().mockResolvedValue({ id: SCOPE.turnId }),
        },
        workspace: {
          findFirst: vi
            .fn()
            .mockResolvedValue({ id: SCOPE.workspaceId, organizationId: null }),
        },
        sokoBotToolCall: {
          findUnique: transactionToolCallFindUniqueMock,
          count: transactionToolCallCountMock,
          create: transactionToolCallCreateMock,
          updateMany: toolCallUpdateManyMock,
        },
      }),
    );
    const refusing = new SokoBotRuntimeService();
    refusing.authorize = vi.fn().mockResolvedValue(ownerChat);
    await expect(
      refusing.executeTool({
        ...SCOPE,
        capability: "generate_image",
        toolCallId: "call-image-2",
        input: request,
      }),
    ).rejects.toThrow("Not enough credits for this image.");
    expect(toolCallUpdateManyMock.mock.calls.at(-1)?.[0].data).toMatchObject({
      status: "FAILED",
      disposition: "REJECTED",
      operationKey: null,
    });
  });

  it("records a refused image as rejected, before anything is reserved", async () => {
    images.credits.mockReturnValue(25);
    toolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallFindUniqueMock.mockResolvedValue(null);
    transactionToolCallCountMock.mockResolvedValue(0);
    toolCallUpdateManyMock.mockReset().mockResolvedValue({ count: 1 });
    serializableTransactionMock.mockImplementation(async (operation) =>
      operation({
        $queryRaw: transactionTurnLockMock,
        sokoBotTurn: {
          findFirst: vi.fn().mockResolvedValue({ id: SCOPE.turnId }),
        },
        sokoBotToolCall: {
          findUnique: transactionToolCallFindUniqueMock,
          count: transactionToolCallCountMock,
          create: transactionToolCallCreateMock,
          updateMany: toolCallUpdateManyMock,
        },
      }),
    );
    const refusing = new SokoBotRuntimeService();
    refusing.authorize = vi.fn().mockResolvedValue(ownerChat);
    await expect(
      refusing.executeTool({
        ...SCOPE,
        capability: "generate_image",
        toolCallId: "call-image",
        input: request,
      }),
    ).rejects.toThrow("costs 25 credits");
    expect(toolCallUpdateManyMock).toHaveBeenCalledTimes(1);
    expect(toolCallUpdateManyMock.mock.calls[0][0].data).toMatchObject({
      status: "FAILED",
      disposition: "REJECTED",
      operationKey: null,
    });
    expect(images.create).not.toHaveBeenCalled();
  });
});

describe("create_task on an event turn", () => {
  const inbox = vi.fn();
  const eventTurn = {
    turn: {
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      workspaceId: SCOPE.workspaceId,
      userId: SCOPE.userId,
      source: "EVENT",
    },
  };
  function create(input: Record<string, unknown>) {
    serializableTransactionMock.mockImplementationOnce(async (operation) =>
      operation({
        sokoBotEventInbox: { findMany: inbox },
        task: { findFirst: vi.fn().mockResolvedValue(null) },
      }),
    );
    const service = new SokoBotRuntimeService();
    service["requireMutationAuthority"] = vi.fn().mockResolvedValue({});
    return service["createTask"](
      eventTurn as never,
      { name: "Follow-up", ...input },
      "call-follow-up",
    );
  }

  it("follows up the batch's only Task when none is named", async () => {
    inbox.mockReset().mockResolvedValue([{ entityId: "task-1" }]);
    // The claim is then checked against that Task, as if it had been named.
    await expect(create({})).rejects.toThrow("no current authority");
    expect(inbox).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entityId: "task-1" }),
      }),
    );
  });

  it("asks which Task when the batch has several", async () => {
    inbox
      .mockReset()
      .mockResolvedValue([{ entityId: "task-1" }, { entityId: "task-2" }]);
    await expect(create({})).rejects.toThrow("one of task-1, task-2");
  });
});

describe("find_agents", () => {
  const listing = (id: string, name: string) => ({
    id,
    name,
    summary: null,
    description: null,
    capabilityName: null,
    paymentType: "Web3CardanoV1",
    riskClassification: null,
    price: { pricingType: "FIXED", credits: 30 },
  });
  const search = (query: string) =>
    new SokoBotRuntimeService()["executeAuthorizedTool"]({
      ...SCOPE,
      capability: "find_agents",
      toolCallId: "call-agents",
      input: { query },
    } as never);

  beforeEach(() => {
    marketplace.list.mockResolvedValue({
      count: 2,
      agents: [listing("a", "Company Researcher"), listing("b", "SEO Auditor")],
    });
    turnFindUniqueMock.mockResolvedValue({
      userMessage: "find an agent",
      id: SCOPE.turnId,
      sokoBotId: SCOPE.sokoBotId,
      userId: SCOPE.userId,
      workspaceId: SCOPE.workspaceId,
      capabilityNames: ["find_agents"],
      contextSnapshot: { id: "snapshot", packet: { memory: { version: 1 } } },
      eveSessionId: SCOPE.sessionId,
      status: "RUNNING",
      deadlineAt: new Date(Date.now() + 60_000),
      leaseExpiresAt: new Date(Date.now() + 60_000),
      sokoBot: { archivedAt: null, status: "RUNNING" },
    });
  });

  it("returns unrated Agents, and no verdict, when Jev is unavailable", async () => {
    marketplace.rate.mockResolvedValue(null);
    const result = await search("write blog posts");
    expect(result).toMatchObject({
      agents: [
        { id: "a", fit: null, price: { credits: 30 } },
        { id: "b", fit: null },
      ],
    });
    expect(result).not.toHaveProperty("note");
  });

  it("says plainly that none fits when Jev rated them all low", async () => {
    marketplace.rate.mockResolvedValue(
      new Map([
        ["a", 0.1],
        ["b", 0.2],
      ]),
    );
    const result = await search("write blog posts");
    // The nearest listings come back apart, best first, never as a fit.
    expect(result).toMatchObject({
      agents: [],
      closest: [
        { id: "b", fit: 0.2 },
        { id: "a", fit: 0.1 },
      ],
    });
    expect(result).toHaveProperty(
      "note",
      expect.stringContaining("No available Agent fits"),
    );
  });
});

describe("archive_task without approval cards", () => {
  const TASK_ID = "01960001-0001-7001-8001-0000000000aa";

  it("archives the Task the model names, whatever the owner's message said", async () => {
    // "yes" and "archive all my test tasks" name no single Task. The route
    // already granted archiving; the owner's words are the model's to read,
    // not Core's to parse, and nothing waits on a card.
    const service = new SokoBotRuntimeService();
    const internals = service as unknown as {
      applyTaskMutation: (...args: unknown[]) => Promise<unknown>;
      createDecision: () => Promise<unknown>;
    };
    const apply = vi
      .spyOn(internals, "applyTaskMutation")
      .mockResolvedValue({ id: TASK_ID });
    const createDecision = vi.spyOn(internals, "createDecision");
    const input = {
      taskId: TASK_ID,
      expectedUpdatedAt: new Date().toISOString(),
    };
    await expect(
      service["mutateTask"](
        { turn: { id: "turn_1", userId: "u", workspaceId: "w" } } as never,
        input,
        "call_1",
        { capability: "archive_task" },
      ),
    ).resolves.toEqual({ id: TASK_ID });
    expect(apply).toHaveBeenCalledWith(
      expect.anything(),
      input,
      "call_1",
      expect.objectContaining({ taskId: TASK_ID, archive: true }),
      "archive_task",
      false,
    );
    expect(createDecision).not.toHaveBeenCalled();
  });
});
