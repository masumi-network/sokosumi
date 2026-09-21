import { describe, expect, it, vi } from "vitest";
import { createCoreClient } from "@/lib/clients/core.shared";
import {
  deleteAdminInvoice as coreDeleteAdminInvoice,
  deleteTasksByIdSchedule as coreDeleteTasksByIdSchedule,
  getCoworkers as coreGetCoworkers,
  getCoworkersById as coreGetCoworkersById,
  getProjectsByIdClose as coreGetProjectsByIdClose,
  postProjectsByIdClose as corePostProjectsByIdClose,
  postProjectsByIdCloseCancelOwed as corePostProjectsByIdCloseCancelOwed,
  postProjectsByIdCloseRetry as corePostProjectsByIdCloseRetry,
  postTasksScheduled as corePostTasksScheduled,
  putTasksByIdCalendarSchedule as corePutTasksByIdCalendarSchedule,
  putTasksByIdCalendarSource as corePutTasksByIdCalendarSource,
  startAdminImpersonation as coreStartAdminImpersonation,
  stopAdminImpersonation as coreStopAdminImpersonation,
  type PostTasksScheduledResponse,
} from "@/lib/clients/generated/core";
import type { Client } from "@/lib/clients/generated/core/client";

vi.mock("@/lib/clients/generated/core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/clients/generated/core")>();
  return {
    ...actual,
    deleteAdminInvoice: vi.fn(),
    deleteTasksByIdSchedule: vi.fn(),
    getCoworkers: vi.fn(),
    getCoworkersById: vi.fn(),
    getProjectsByIdClose: vi.fn(),
    postProjectsByIdClose: vi.fn(),
    postProjectsByIdCloseCancelOwed: vi.fn(),
    postProjectsByIdCloseRetry: vi.fn(),
    postTasksScheduled: vi.fn(),
    putTasksByIdCalendarSchedule: vi.fn(),
    putTasksByIdCalendarSource: vi.fn(),
    startAdminImpersonation: vi.fn(),
    stopAdminImpersonation: vi.fn(),
  };
});

describe("createCoreClient no-content responses", () => {
  it("treats 204 responses with undefined data as success", async () => {
    vi.mocked(coreDeleteAdminInvoice).mockResolvedValue({
      data: undefined,
      response: { ok: true, status: 204 } as Response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    await expect(core.deleteAdminInvoice("in_1")).resolves.toBeUndefined();
  });
});

describe("createCoreClient owned coworkers", () => {
  it("requests owned scope with no-store caching", async () => {
    vi.mocked(coreGetCoworkers).mockResolvedValue({
      data: { data: [], meta: { timestamp: new Date(), requestId: "req_1" } },
      response: { ok: true, status: 200 } as Response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    await core.getOwnedCoworkers();

    expect(coreGetCoworkers).toHaveBeenCalledWith({
      client: {},
      query: { scope: "owned" },
      cache: "no-store",
    });
  });

  it("requests owned coworker by id with no-store caching", async () => {
    vi.mocked(coreGetCoworkersById).mockResolvedValue({
      data: {
        data: { id: "cow_1" },
        meta: { timestamp: new Date(), requestId: "req_1" },
      },
      response: { ok: true, status: 200 } as Response,
    } as never);

    const core = createCoreClient(async () => ({}) as Client);

    await core.getOwnedCoworkerById("cow_1");

    expect(coreGetCoworkersById).toHaveBeenCalledWith({
      client: {},
      path: { id: "cow_1" },
      query: { scope: "owned" },
      cache: "no-store",
    });
  });
});

describe("createCoreClient revision-safe schedule mutations", () => {
  const taskResponse = {
    id: "task-1",
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T09:00:00.000Z",
    nextRunAt: null,
    events: [],
    jobs: [],
    share: null,
    links: [],
  };

  it("sends the strict Calendar series body", async () => {
    vi.mocked(corePutTasksByIdCalendarSchedule).mockResolvedValue({
      data: taskResponse,
      response: { ok: true, status: 200 } as Response,
    } as never);
    const core = createCoreClient(async () => ({}) as Client);
    const body = {
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      expectedScheduleRevision: 3,
      discardFutureExceptions: true as const,
      schedule: {
        mode: "recurring" as const,
        expr: "0 9 * * *",
        timezone: "UTC",
      },
    };

    await core.putTaskCalendarSchedule("task-1", body);

    expect(corePutTasksByIdCalendarSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: "task-1" }, body }),
    );
  });

  it("sends the revision-safe Calendar source move body", async () => {
    const mutation = {
      previousSource: { type: "workspace" as const },
      source: {
        type: "project" as const,
        projectId: "11111111-1111-4111-8111-111111111111",
      },
      scheduleRevision: 4,
      canceledFutureExceptionCount: 2,
    };
    vi.mocked(corePutTasksByIdCalendarSource).mockResolvedValue({
      data: { data: mutation },
      response: { ok: true, status: 200 } as Response,
    } as never);
    const core = createCoreClient(async () => ({}) as Client);
    const body = {
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      expectedScheduleRevision: 3,
      discardFutureExceptions: true as const,
      source: mutation.source,
    };

    await expect(
      core.putTaskCalendarSource("task-1", body),
    ).resolves.toMatchObject({ data: mutation });
    expect(corePutTasksByIdCalendarSource).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: "task-1" }, body }),
    );
  });

  it("sends the removal preconditions without the platform-sensitive If-Match header", async () => {
    vi.mocked(coreDeleteTasksByIdSchedule).mockResolvedValue({
      data: taskResponse,
      response: { ok: true, status: 200 } as Response,
    } as never);
    const core = createCoreClient(async () => ({}) as Client);

    await core.deleteTaskSchedule("task-1", {
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      expectedScheduleRevision: 3,
    });

    expect(coreDeleteTasksByIdSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "task-1" },
        headers: {
          "idempotency-key": "123e4567-e89b-42d3-a456-426614174000",
          "x-sokosumi-schedule-revision": "3",
        },
      }),
    );
  });
});

describe("createCoreClient project close lifecycle", () => {
  const status = {
    id: "123e4567-e89b-42d3-a456-426614174001",
    projectId: "123e4567-e89b-42d3-a456-426614174002",
    state: "CLOSING" as const,
    cutoffAt: new Date("2026-09-14T10:00:00.000Z"),
    reason: null,
    attempts: 0,
    failure: null,
    completedAt: null,
    projectRevision: 4,
    owedOccurrenceCount: 2,
  };

  it("reads close status without caching", async () => {
    vi.mocked(coreGetProjectsByIdClose).mockResolvedValue({
      data: { data: status },
      response: { ok: true, status: 200 } as Response,
    } as never);
    const core = createCoreClient(async () => ({}) as Client);

    await core.getProjectsByIdClose(status.projectId);

    expect(coreGetProjectsByIdClose).toHaveBeenCalledWith({
      client: {},
      path: { id: status.projectId },
      cache: "no-store",
    });
  });

  it("sends close and recovery bodies unchanged", async () => {
    for (const mutation of [
      corePostProjectsByIdClose,
      corePostProjectsByIdCloseRetry,
      corePostProjectsByIdCloseCancelOwed,
    ]) {
      vi.mocked(mutation).mockResolvedValue({
        data: { data: status },
        response: { ok: true, status: 200 } as Response,
      } as never);
    }
    const core = createCoreClient(async () => ({}) as Client);
    const closeBody = {
      operationId: "123e4567-e89b-42d3-a456-426614174003",
      expectedProjectRevision: 3,
      reason: "Campaign complete",
    };
    const recoveryBody = {
      operationId: "123e4567-e89b-42d3-a456-426614174004",
      expectedProjectRevision: 4,
      reason: "Reviewed the blocked series",
    };

    await core.postProjectsByIdClose(status.projectId, closeBody);
    await core.postProjectsByIdCloseRetry(status.projectId, recoveryBody);
    await core.postProjectsByIdCloseCancelOwed(status.projectId, recoveryBody);

    expect(corePostProjectsByIdClose).toHaveBeenCalledWith(
      expect.objectContaining({
        client: {},
        path: { id: status.projectId },
        body: closeBody,
      }),
    );
    expect(corePostProjectsByIdCloseRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        client: {},
        path: { id: status.projectId },
        body: recoveryBody,
      }),
    );
    expect(corePostProjectsByIdCloseCancelOwed).toHaveBeenCalledWith(
      expect.objectContaining({
        client: {},
        path: { id: status.projectId },
        body: recoveryBody,
      }),
    );
  });
});

describe("createCoreClient scheduled tasks", () => {
  it("creates scheduled tasks and transforms their Task response", async () => {
    const taskResponse = {
      id: "task-1",
      createdAt: "2026-08-20T09:00:00.000Z",
      updatedAt: "2026-08-20T09:00:00.000Z",
      nextRunAt: "2026-08-21T09:00:00.000Z",
      events: [],
      jobs: [],
      share: null,
      links: [],
    };
    vi.mocked(corePostTasksScheduled).mockImplementation(async (options) => {
      const data = await options?.responseTransformer?.({
        data: taskResponse,
        meta: {
          requestId: "req-1",
          timestamp: "2026-08-20T09:00:00.000Z",
        },
      });

      return {
        data: data as PostTasksScheduledResponse,
        response: { ok: true, status: 201 } as Response,
      };
    });
    const body = {
      operationId: "123e4567-e89b-42d3-a456-426614174000",
      source: { type: "workspace" as const },
      name: "Scheduled task",
      assigneeId: "coworker-1",
      schedule: {
        mode: "recurring" as const,
        expr: "0 9 * * *",
        timezone: "UTC",
      },
    };
    const core = createCoreClient(async () => ({}) as Client);

    const result = await core.createScheduledTask(body);

    expect(corePostTasksScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        client: {},
        body,
        responseTransformer: expect.any(Function),
      }),
    );
    expect(result.data.createdAt).toEqual(new Date("2026-08-20T09:00:00.000Z"));
    expect(result.data.nextRunAt).toEqual(new Date("2026-08-21T09:00:00.000Z"));
  });
});

describe("createCoreClient impersonation", () => {
  it("starts an impersonation and keeps the response for cookie reads", async () => {
    const response = new Response(null, { status: 201 });
    response.headers.append("set-cookie", "session_token=abc; Path=/");
    vi.mocked(coreStartAdminImpersonation).mockResolvedValue({
      data: {
        data: { id: "user_target", name: "T", email: "t@example.com" },
        meta: { timestamp: new Date(), requestId: "req_1" },
      },
      response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    const result = await core.startAdminImpersonation({
      userId: "user_target",
      reason: "SOK-1: x",
    });

    expect(coreStartAdminImpersonation).toHaveBeenCalledWith({
      client: {},
      body: { userId: "user_target", reason: "SOK-1: x" },
      cache: "no-store",
    });
    expect(result.data.data).toEqual({
      id: "user_target",
      name: "T",
      email: "t@example.com",
    });
    expect(result.response).toBe(response);
  });

  it("stops an impersonation and keeps the response for cookie reads", async () => {
    const response = new Response(null, { status: 200 });
    vi.mocked(coreStopAdminImpersonation).mockResolvedValue({
      data: {
        data: { id: "user_admin", name: "A", email: "a@example.com" },
        meta: { timestamp: new Date(), requestId: "req_1" },
      },
      response,
    });

    const core = createCoreClient(async () => ({}) as Client);

    const result = await core.stopAdminImpersonation();

    expect(coreStopAdminImpersonation).toHaveBeenCalledWith({
      client: {},
      cache: "no-store",
    });
    expect(result.data.data).toEqual({
      id: "user_admin",
      name: "A",
      email: "a@example.com",
    });
    expect(result.response).toBe(response);
  });
});
