import { type Prisma, TaskStatus, VendorGrantStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CreateScheduledTaskInput } from "./task-schedule-create.service";
import {
  createScheduledTaskInTransaction,
  requireScheduledTaskCreator,
} from "./task-schedule-create.service";

const {
  createTaskForActorMock,
  lockCalendarScopeMock,
  replaceTaskSchedulePlannedOccurrencesMock,
  requireCoworkerCapabilityMock,
} = vi.hoisted(() => ({
  createTaskForActorMock: vi.fn(),
  lockCalendarScopeMock: vi.fn(),
  replaceTaskSchedulePlannedOccurrencesMock: vi.fn(),
  requireCoworkerCapabilityMock: vi.fn(),
}));

vi.mock("@/helpers/access-control", () => ({
  requireCoworkerCapability: requireCoworkerCapabilityMock,
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
        }),
      }),
      tx,
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
        requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
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
