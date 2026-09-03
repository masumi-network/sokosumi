import { describe, expect, it, vi } from "vitest";
import { createCoreClient } from "@/lib/clients/core.shared";
import {
  deleteAdminInvoice as coreDeleteAdminInvoice,
  getCoworkers as coreGetCoworkers,
  postTasksScheduled as corePostTasksScheduled,
  type PostTasksScheduledResponse,
} from "@/lib/clients/generated/core";
import type { Client } from "@/lib/clients/generated/core/client";

vi.mock("@/lib/clients/generated/core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/clients/generated/core")>();
  return {
    ...actual,
    deleteAdminInvoice: vi.fn(),
    getCoworkers: vi.fn(),
    postTasksScheduled: vi.fn(),
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
