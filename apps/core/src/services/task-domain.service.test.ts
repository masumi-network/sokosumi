import { type Task, TaskPriority, TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { publicWorkMadeBy, WORK_MAKERS } from "@/test-fixtures/work-made-by";

import { createTaskForActor, updateTaskForActor } from "./task-domain.service";

const access = vi.hoisted(() => ({ requireTaskWriteAccess: vi.fn() }));
vi.mock("@/helpers/access-control", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/access-control")>()),
  requireTaskWriteAccess: access.requireTaskWriteAccess,
}));

describe("createTaskForActor", () => {
  it("rejects a human assignee on a private Task", async () => {
    const taskCreateMock = vi.fn();
    const tx = { task: { create: taskCreateMock } } as never;

    await expect(
      createTaskForActor(
        {
          actor: { kind: "user", userId: "user_123" },
          ownerId: "user_123",
          organizationId: "org_123",
          workspaceId: "workspace_123",
          name: "Secret",
          status: TaskStatus.DRAFT,
          visibility: "PRIVATE",
          assigneeUserId: "user_teammate",
        },
        tx,
      ),
    ).rejects.toMatchObject({
      status: 400,
      message: "Private Tasks cannot be assigned to a human teammate",
    });
    expect(taskCreateMock).not.toHaveBeenCalled();
  });

  it("persists the requested priority", async () => {
    const taskCreateMock = vi.fn().mockResolvedValue({ id: "tsk_123" });
    const tx = { task: { create: taskCreateMock } } as never;

    await createTaskForActor(
      {
        actor: { kind: "user", userId: "user_123" },
        ownerId: "user_123",
        organizationId: "org_123",
        workspaceId: "workspace_123",
        name: "Urgent",
        status: TaskStatus.DRAFT,
        priority: TaskPriority.URGENT,
      },
      tx,
    );

    expect(taskCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ priority: TaskPriority.URGENT }),
      }),
    );
  });

  it("writes the creation event, then the initial status event", async () => {
    const taskCreateMock = vi.fn().mockResolvedValue({ id: "tsk_123" });
    const tx = { task: { create: taskCreateMock } } as never;

    await createTaskForActor(
      {
        actor: { kind: "soko_bot", sokoBotId: "bot_123" },
        ownerId: "user_123",
        organizationId: "org_123",
        workspaceId: "workspace_123",
        name: "Bot Task",
        status: TaskStatus.DRAFT,
        effectEventId: "event_effect",
      },
      tx,
    );

    const [created, status] = taskCreateMock.mock.calls[0]![0].data.events
      .create as {
      id?: string;
      status: TaskStatus | null;
      comment: string | null;
      sokoBotId: string;
      createdAt: Date;
    }[];
    expect(created).toMatchObject({
      status: TaskStatus.CREATED,
      comment: null,
      sokoBotId: "bot_123",
    });
    expect(created.id).toBeUndefined();
    // The effect receipt points at the status event, not the creation event.
    expect(status).toMatchObject({
      id: "event_effect",
      status: TaskStatus.DRAFT,
      sokoBotId: "bot_123",
    });
    expect(created.createdAt.getTime()).toBeLessThan(
      status.createdAt.getTime(),
    );
  });
});

describe("a Soko Bot archiving a Task", () => {
  const updatedAt = new Date("2026-10-01T10:00:00Z");
  const teammateTask = {
    id: "task_teammate",
    ownerId: "user_teammate",
    workspaceId: "workspace_org",
    status: TaskStatus.DRAFT,
    runAt: null,
    updatedAt,
  } as unknown as Task;
  const tx = {
    task: { updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    taskEvent: { create: vi.fn() },
  };
  const archive = () =>
    updateTaskForActor(
      {
        actor: { kind: "soko_bot", sokoBotId: "bot_owner" },
        userId: "user_owner",
        workspaceId: "workspace_org",
        taskId: teammateTask.id,
        intent: "metadata",
        archive: true,
        expectedUpdatedAt: updatedAt,
        effectEventId: "event_archive",
      },
      tx as never,
    );

  beforeEach(() => {
    vi.resetAllMocks();
    tx.task.updateMany.mockResolvedValue({ count: 1 });
    tx.task.findUniqueOrThrow.mockResolvedValue(teammateTask);
  });

  it("archives a teammate's Task its owner could archive in the app", async () => {
    access.requireTaskWriteAccess.mockResolvedValue(teammateTask);

    await expect(archive()).resolves.toBe(teammateTask);
    expect(access.requireTaskWriteAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_owner" }),
      teammateTask.id,
      tx,
      { right: "manage" },
    );
    expect(tx.task.updateMany).toHaveBeenCalledOnce();
  });

  it("cannot see a Task its owner cannot", async () => {
    access.requireTaskWriteAccess.mockRejectedValue(notFound("Task not found"));

    await expect(archive()).rejects.toMatchObject({ status: 404 });
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("stays inside its own workspace", async () => {
    access.requireTaskWriteAccess.mockResolvedValue({
      ...teammateTask,
      workspaceId: "workspace_other",
    });

    await expect(archive()).rejects.toMatchObject({ status: 404 });
    expect(tx.task.updateMany).not.toHaveBeenCalled();
  });
});

describe("a person changing a Task through the domain update (ADR 0057)", () => {
  const tx = { task: { findFirst: vi.fn(), update: vi.fn() } };
  const rename = () =>
    updateTaskForActor(
      {
        actor: { kind: "user", userId: "user_123" },
        userId: "user_123",
        taskId: "task_1",
        intent: "metadata",
        name: "Renamed",
      },
      tx as never,
    );

  function storedTask(columns: ReturnType<typeof publicWorkMadeBy>) {
    return {
      id: "task_1",
      workspaceId: "workspace_org",
      status: TaskStatus.DRAFT,
      visibility: "PUBLIC",
      assigneeId: null,
      assigneeSokoBotId: null,
      assigneeUserId: null,
      runAt: null,
      updatedAt: new Date("2026-10-01T10:00:00Z"),
      ...columns,
    };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    tx.task.update.mockImplementation(async ({ data }) => ({
      id: "task_1",
      ...data,
    }));
  });

  it.each(WORK_MAKERS)(
    "lets the Owner change a Task made by a %s",
    async (maker) => {
      tx.task.findFirst.mockResolvedValue(
        storedTask(publicWorkMadeBy(maker, "user_123")),
      );

      await expect(rename()).resolves.toMatchObject({ name: "Renamed" });
      expect(tx.task.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: "task_1",
            ownerId: "user_123",
          }),
        }),
      );
      expect(tx.task.update).toHaveBeenCalledOnce();
    },
  );

  it("refuses a Task the person does not own, with or without an Owner", async () => {
    tx.task.findFirst.mockResolvedValue(null);

    await expect(rename()).rejects.toMatchObject({ status: 404 });
    expect(tx.task.update).not.toHaveBeenCalled();
  });
});
