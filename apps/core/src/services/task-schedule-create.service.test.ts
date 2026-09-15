import {
  type Prisma,
  TaskScheduleEventKind,
  TaskStatus,
  VendorGrantStatus,
} from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  canonicalTaskScheduleInput,
  createTaskScheduleRequestFingerprint,
} from "@/helpers/task-schedule-operation";
import type { AuthenticationContext } from "@/middleware/auth";

import type { CreateScheduledTaskInput } from "./task-schedule-create.service";
import {
  createScheduledTaskInTransaction,
  requireScheduledTaskCreator,
  requireScheduledTaskCreatorOrRequestGrant,
} from "./task-schedule-create.service";

const {
  createTaskForActorMock,
  lockCalendarScopeMock,
  prismaVendorGrantFindUniqueMock,
  replaceTaskSchedulePlannedOccurrencesMock,
  requestWorkspaceGrantCommittedMock,
  requireCoworkerCapabilityMock,
} = vi.hoisted(() => ({
  createTaskForActorMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  prismaVendorGrantFindUniqueMock: vi.fn(),
  replaceTaskSchedulePlannedOccurrencesMock: vi.fn(),
  requestWorkspaceGrantCommittedMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/access-control")>();
  return {
    ...actual,
    requireCoworkerCapability: requireCoworkerCapabilityMock,
  };
});

vi.mock("@/helpers/vendor-grants", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/helpers/vendor-grants")>();
  return {
    ...actual,
    requestWorkspaceGrantCommitted: requestWorkspaceGrantCommittedMock,
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    vendorGrant: { findUnique: prismaVendorGrantFindUniqueMock },
  },
}));

vi.mock("@/helpers/calendar-locks", () => ({
  lockCalendarScope: lockCalendarScopeMock,
}));

vi.mock("@/helpers/task-schedule-occurrence-index", () => ({
  replaceTaskSchedulePlannedOccurrences:
    replaceTaskSchedulePlannedOccurrencesMock,
}));

vi.mock("@/services/task-domain.service", () => ({
  createTaskForActor: createTaskForActorMock,
}));

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const PROJECT_ID = "22222222-2222-7222-8222-222222222222";
const OPERATION_ID = "123e4567-e89b-42d3-a456-426614174000";

interface ScheduledTaskCreationTransactionFixture {
  taskScheduleCreateOperation: Pick<
    Prisma.TransactionClient["taskScheduleCreateOperation"],
    "create" | "findUnique"
  >;
  project: Pick<Prisma.TransactionClient["project"], "findFirst">;
  vendorGrant: Pick<Prisma.TransactionClient["vendorGrant"], "findUnique">;
}

function createTransaction() {
  const taskScheduleCreateOperationFindUniqueMock = vi.fn();
  const taskScheduleCreateOperationCreateMock = vi.fn();
  const projectFindFirstMock = vi.fn();
  const vendorGrantFindUniqueMock = vi.fn();

  const transaction = {
    taskScheduleCreateOperation: {
      findUnique: taskScheduleCreateOperationFindUniqueMock,
      create: taskScheduleCreateOperationCreateMock,
    },
    project: { findFirst: projectFindFirstMock },
    vendorGrant: { findUnique: vendorGrantFindUniqueMock },
  } satisfies ScheduledTaskCreationTransactionFixture;

  // The command's collaborators are mocked at their module boundaries; its
  // declared transaction type is broader than the properties it consumes here.
  const tx = transaction as never;

  return {
    tx,
    projectFindFirstMock,
    taskScheduleCreateOperationCreateMock,
    taskScheduleCreateOperationFindUniqueMock,
    vendorGrantFindUniqueMock,
  };
}

function createInput(): CreateScheduledTaskInput {
  return {
    creator: {
      userContext: {
        source: "session",
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
        role: "user",
      },
      actor: { kind: "user", userId: "user_123" },
    },
    workspaceId: WORKSPACE_ID,
    organizationId: "org_123",
    operationId: OPERATION_ID,
    source: { type: "project", projectId: PROJECT_ID },
    name: "Prepare release notes",
    description: "Draft the public notes",
    assigneeId: "coworker_123",
    schedule: {
      mode: "once",
      runAt: "2099-09-24T09:00:00.000Z",
    },
  };
}

describe("createScheduledTaskInTransaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lockCalendarScopeMock.mockResolvedValue(true);
    createTaskForActorMock.mockResolvedValue({ id: "task_123" });
    replaceTaskSchedulePlannedOccurrencesMock.mockResolvedValue(undefined);
  });

  it("atomically creates a queued v2 Task, its occurrence index, and its replay record", async () => {
    const { tx, projectFindFirstMock, taskScheduleCreateOperationCreateMock } =
      createTransaction();
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closingAt: null,
      closedAt: null,
    });

    await expect(
      createScheduledTaskInTransaction(createInput(), tx),
    ).resolves.toBe("task_123");

    expect(createTaskForActorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        status: TaskStatus.QUEUED,
        schedule: expect.objectContaining({
          nextRunAt: new Date("2099-09-24T09:00:00.000Z"),
          metadata: expect.objectContaining({
            version: 2,
            mode: "once",
            sourceRunAt: "2099-09-24T09:00:00.000Z",
            effectiveRunAt: "2099-09-24T09:00:00.000Z",
          }),
          event: {
            scheduleKind: TaskScheduleEventKind.CREATED,
            scheduleOperationId: OPERATION_ID,
            schedulePayload: {
              action: "create_schedule",
              epochId: expect.any(String),
              nextRunAt: "2099-09-24T09:00:00.000Z",
              source: { type: "project", projectId: PROJECT_ID },
              schedule: {
                mode: "once",
                runAt: "2099-09-24T09:00:00.000Z",
              },
            },
          },
        }),
      }),
      tx,
    );
    const createdSchedule = createTaskForActorMock.mock.calls[0]?.[0]?.schedule;
    expect(createdSchedule.event.schedulePayload.epochId).toBe(
      createdSchedule.metadata.epochId,
    );
    expect(replaceTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        id: "task_123",
        workspaceId: WORKSPACE_ID,
        projectId: PROJECT_ID,
        schedule: expect.objectContaining({ version: 2 }),
      }),
    );
    expect(taskScheduleCreateOperationCreateMock).toHaveBeenCalledWith({
      data: {
        workspaceId: WORKSPACE_ID,
        operationId: OPERATION_ID,
        taskId: "task_123",
        requestFingerprint: createTaskScheduleRequestFingerprint({
          workspaceId: WORKSPACE_ID,
          source: { type: "project", projectId: PROJECT_ID },
          assigneeId: "coworker_123",
          assigneeUserId: undefined,
          request: {
            name: "Prepare release notes",
            description: "Draft the public notes",
          },
          schedule: canonicalTaskScheduleInput({
            mode: "once",
            runAt: "2099-09-24T09:00:00.000Z",
          }),
        }),
      },
    });
  });

  it("creates human scheduled Tasks as READY without entering the agent queue", async () => {
    const { tx, projectFindFirstMock } = createTransaction();
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closingAt: null,
      closedAt: null,
    });

    await expect(
      createScheduledTaskInTransaction(
        {
          ...createInput(),
          assigneeId: null,
          assigneeUserId: "user_assignee_123",
        },
        tx,
      ),
    ).resolves.toBe("task_123");

    expect(createTaskForActorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        assigneeId: null,
        assigneeUserId: "user_assignee_123",
        status: TaskStatus.READY,
      }),
      tx,
    );
  });

  it.each([
    [
      "workspace",
      (input: CreateScheduledTaskInput) => ({
        ...input,
        workspaceId: "33333333-3333-7333-8333-333333333333",
      }),
    ],
    [
      "resolved source",
      (input: CreateScheduledTaskInput) => ({
        ...input,
        source: { type: "workspace" as const },
      }),
    ],
    [
      "assignee",
      (input: CreateScheduledTaskInput) => ({
        ...input,
        assigneeId: "coworker_456",
      }),
    ],
    [
      "name",
      (input: CreateScheduledTaskInput) => ({
        ...input,
        name: "Publish release notes",
      }),
    ],
    [
      "description",
      (input: CreateScheduledTaskInput) => ({
        ...input,
        description: "Draft the internal notes",
      }),
    ],
    [
      "schedule",
      (input: CreateScheduledTaskInput) => ({
        ...input,
        schedule: {
          mode: "recurring" as const,
          expr: "0 9 * * 1",
          timezone: "America/New_York",
          endsMode: "after" as const,
          occurrences: 3,
          intervalDays: 2,
          anchorAt: "2099-09-24T09:00:00.000Z",
        },
      }),
    ],
  ])("rejects a replay when its %s differs", async (_field, changeInput) => {
    const {
      tx,
      projectFindFirstMock,
      taskScheduleCreateOperationCreateMock,
      taskScheduleCreateOperationFindUniqueMock,
    } = createTransaction();
    let operation: { taskId: string; requestFingerprint: string } | null = null;
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closingAt: null,
      closedAt: null,
    });
    taskScheduleCreateOperationFindUniqueMock.mockImplementation(
      async () => operation,
    );
    taskScheduleCreateOperationCreateMock.mockImplementation(
      async ({
        data,
      }: {
        data: { taskId: string; requestFingerprint: string };
      }) => {
        operation = {
          taskId: data.taskId,
          requestFingerprint: data.requestFingerprint,
        };
      },
    );

    await expect(
      createScheduledTaskInTransaction(createInput(), tx),
    ).resolves.toBe("task_123");
    await expect(
      createScheduledTaskInTransaction(changeInput(createInput()), tx),
    ).rejects.toThrow(
      "operationId was already used with a different scheduled Task request",
    );

    expect(createTaskForActorMock).toHaveBeenCalledTimes(1);
    expect(replaceTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledTimes(1);
    expect(taskScheduleCreateOperationCreateMock).toHaveBeenCalledTimes(1);
    expect(lockCalendarScopeMock).toHaveBeenCalledTimes(1);
  });

  it("returns the original Task without another write when an operation is replayed with the same payload", async () => {
    const {
      tx,
      projectFindFirstMock,
      taskScheduleCreateOperationCreateMock,
      taskScheduleCreateOperationFindUniqueMock,
    } = createTransaction();
    let operation: { taskId: string; requestFingerprint: string } | null = null;
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closingAt: null,
      closedAt: null,
    });
    taskScheduleCreateOperationFindUniqueMock.mockImplementation(
      async () => operation,
    );
    taskScheduleCreateOperationCreateMock.mockImplementation(
      async ({
        data,
      }: {
        data: { taskId: string; requestFingerprint: string };
      }) => {
        operation = {
          taskId: data.taskId,
          requestFingerprint: data.requestFingerprint,
        };
      },
    );

    await createScheduledTaskInTransaction(createInput(), tx);

    const reorderedReplayInput: CreateScheduledTaskInput = {
      ...createInput(),
      schedule: {
        runAt: "2099-09-24T09:00:00.000Z",
        mode: "once",
      },
    };

    await expect(
      createScheduledTaskInTransaction(reorderedReplayInput, tx),
    ).resolves.toBe("task_123");

    expect(createTaskForActorMock).toHaveBeenCalledTimes(1);
    expect(replaceTaskSchedulePlannedOccurrencesMock).toHaveBeenCalledTimes(1);
    expect(taskScheduleCreateOperationCreateMock).toHaveBeenCalledTimes(1);
    expect(lockCalendarScopeMock).toHaveBeenCalledTimes(1);
  });

  it("replays the same request when automatic naming resolves differently", async () => {
    const {
      tx,
      projectFindFirstMock,
      taskScheduleCreateOperationCreateMock,
      taskScheduleCreateOperationFindUniqueMock,
    } = createTransaction();
    let operation: { taskId: string; requestFingerprint: string } | null = null;
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closingAt: null,
      closedAt: null,
    });
    taskScheduleCreateOperationFindUniqueMock.mockImplementation(
      async () => operation,
    );
    taskScheduleCreateOperationCreateMock.mockImplementation(
      async ({
        data,
      }: {
        data: { taskId: string; requestFingerprint: string };
      }) => {
        operation = {
          taskId: data.taskId,
          requestFingerprint: data.requestFingerprint,
        };
      },
    );
    const input = {
      ...createInput(),
      requestFingerprintPayload: {
        name: null,
        description: "Draft the public notes",
        context: null,
      },
    };

    await createScheduledTaskInTransaction(input, tx);
    await expect(
      createScheduledTaskInTransaction(
        { ...input, name: "A different generated name" },
        tx,
      ),
    ).resolves.toBe("task_123");

    expect(createTaskForActorMock).toHaveBeenCalledTimes(1);
  });

  it("rejects an operation that changed while waiting for the Calendar scope lock", async () => {
    const {
      tx,
      projectFindFirstMock,
      taskScheduleCreateOperationFindUniqueMock,
    } = createTransaction();
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closingAt: null,
      closedAt: null,
    });
    taskScheduleCreateOperationFindUniqueMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        taskId: "task_original",
        requestFingerprint: "different-fingerprint",
      });

    await expect(
      createScheduledTaskInTransaction(createInput(), tx),
    ).rejects.toThrow(
      "operationId was already used with a different scheduled Task request",
    );

    expect(createTaskForActorMock).not.toHaveBeenCalled();
    expect(replaceTaskSchedulePlannedOccurrencesMock).not.toHaveBeenCalled();
  });

  it("reports a missing Project instead of a Calendar scope conflict", async () => {
    const { tx, projectFindFirstMock } = createTransaction();
    lockCalendarScopeMock.mockResolvedValue(false);
    projectFindFirstMock.mockResolvedValue(null);

    await expect(
      createScheduledTaskInTransaction(createInput(), tx),
    ).rejects.toThrow("Project not found");

    expect(createTaskForActorMock).not.toHaveBeenCalled();
  });

  it("rejects a closing Project before creating any scheduled work", async () => {
    const { tx, projectFindFirstMock } = createTransaction();
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closingAt: new Date("2026-09-02T08:00:00.000Z"),
      closedAt: null,
    });

    await expect(
      createScheduledTaskInTransaction(createInput(), tx),
    ).rejects.toThrow("Cannot schedule work in a closing or closed Project");

    expect(createTaskForActorMock).not.toHaveBeenCalled();
  });

  it("rejects a closed Project that was never closing before creating any scheduled work", async () => {
    const { tx, projectFindFirstMock } = createTransaction();
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      closingAt: null,
      closedAt: new Date("2026-09-02T08:00:00.000Z"),
    });

    await expect(
      createScheduledTaskInTransaction(createInput(), tx),
    ).rejects.toThrow("Cannot schedule work in a closing or closed Project");

    expect(createTaskForActorMock).not.toHaveBeenCalled();
  });
});

describe("requireScheduledTaskCreator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
  });

  it("allows a granted Coworker to assign another usable Coworker for the contextual user", async () => {
    const { tx, vendorGrantFindUniqueMock } = createTransaction();
    vendorGrantFindUniqueMock.mockResolvedValue({
      status: VendorGrantStatus.GRANTED,
    });

    await expect(
      requireScheduledTaskCreator(
        {
          actor: "coworker",
          coworkerId: "creator_coworker",
          vendorId: "33333333-3333-7333-8333-333333333333",
          context: { userId: "user_123", organizationId: "org_123" },
        },
        WORKSPACE_ID,
        tx,
      ),
    ).resolves.toMatchObject({
      actor: {
        kind: "coworker",
        coworkerId: "creator_coworker",
        enforceWorkspaceGrant: false,
      },
      assigneeAuthorization: { kind: "user", userId: "user_123" },
    });
  });

  it("rejects Coworker scheduled creation without an active workspace grant", async () => {
    const { tx, vendorGrantFindUniqueMock } = createTransaction();
    vendorGrantFindUniqueMock.mockResolvedValue(null);

    await expect(
      requireScheduledTaskCreator(
        {
          actor: "coworker",
          coworkerId: "creator_coworker",
          vendorId: "33333333-3333-7333-8333-333333333333",
          context: { userId: "user_123", organizationId: "org_123" },
        },
        WORKSPACE_ID,
        tx,
      ),
    ).rejects.toThrow("Vendor workspace access is required");
  });
});

describe("requireScheduledTaskCreatorOrRequestGrant", () => {
  const VENDOR_ID = "33333333-3333-7333-8333-333333333333";

  function createCoworkerAuthContext(): AuthenticationContext {
    return {
      actor: "coworker",
      coworkerId: "creator_coworker",
      vendorId: VENDOR_ID,
      context: { userId: "user_123", organizationId: "org_123" },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    requireCoworkerCapabilityMock.mockResolvedValue(undefined);
  });

  it("returns a user creator without touching workspace grants", async () => {
    await expect(
      requireScheduledTaskCreatorOrRequestGrant(
        {
          actor: "user",
          userId: "user_123",
          organizationId: "org_123",
          role: "user",
        },
        WORKSPACE_ID,
      ),
    ).resolves.toMatchObject({
      actor: { kind: "user", userId: "user_123" },
    });

    expect(prismaVendorGrantFindUniqueMock).not.toHaveBeenCalled();
    expect(requestWorkspaceGrantCommittedMock).not.toHaveBeenCalled();
  });

  it("commits a pending request for a Coworker without a grant, then reports grant_required", async () => {
    prismaVendorGrantFindUniqueMock.mockResolvedValue(null);
    requestWorkspaceGrantCommittedMock.mockResolvedValue({
      grant: { id: "grant_123", status: VendorGrantStatus.PENDING },
      created: true,
    });

    await expect(
      requireScheduledTaskCreatorOrRequestGrant(
        createCoworkerAuthContext(),
        WORKSPACE_ID,
      ),
    ).rejects.toThrow("Vendor workspace access is required");

    expect(requestWorkspaceGrantCommittedMock).toHaveBeenCalledWith({
      vendorId: VENDOR_ID,
      workspaceId: WORKSPACE_ID,
      requestedByUserId: "user_123",
    });
  });

  it("keeps an existing pending grant and still reports grant_required", async () => {
    prismaVendorGrantFindUniqueMock.mockResolvedValue({
      id: "grant_123",
      status: VendorGrantStatus.PENDING,
    });
    requestWorkspaceGrantCommittedMock.mockResolvedValue({
      grant: { id: "grant_123", status: VendorGrantStatus.PENDING },
      created: false,
    });

    await expect(
      requireScheduledTaskCreatorOrRequestGrant(
        createCoworkerAuthContext(),
        WORKSPACE_ID,
      ),
    ).rejects.toThrow("Vendor workspace access is required");

    expect(requestWorkspaceGrantCommittedMock).toHaveBeenCalledTimes(1);
  });

  it("returns the Coworker creator after approval grants access on retry", async () => {
    prismaVendorGrantFindUniqueMock.mockResolvedValue(null);
    requestWorkspaceGrantCommittedMock.mockResolvedValue({
      grant: { id: "grant_123", status: VendorGrantStatus.GRANTED },
      created: true,
    });

    await expect(
      requireScheduledTaskCreatorOrRequestGrant(
        createCoworkerAuthContext(),
        WORKSPACE_ID,
      ),
    ).resolves.toMatchObject({
      actor: {
        kind: "coworker",
        coworkerId: "creator_coworker",
        enforceWorkspaceGrant: false,
      },
      assigneeAuthorization: { kind: "user", userId: "user_123" },
    });

    expect(requestWorkspaceGrantCommittedMock).toHaveBeenCalledTimes(1);
    expect(prismaVendorGrantFindUniqueMock).toHaveBeenCalledTimes(1);
  });

  it("keeps denied and revoked grants blocked without requesting again", async () => {
    prismaVendorGrantFindUniqueMock.mockResolvedValue({
      id: "grant_123",
      status: VendorGrantStatus.REVOKED,
    });

    await expect(
      requireScheduledTaskCreatorOrRequestGrant(
        createCoworkerAuthContext(),
        WORKSPACE_ID,
      ),
    ).rejects.toThrow("Vendor workspace access was revoked");

    expect(requestWorkspaceGrantCommittedMock).not.toHaveBeenCalled();
  });
});
