import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";

import mountGetAdminTask from "./get";

const { taskFindUniqueMock } = vi.hoisted(() => ({
  taskFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findUnique: taskFindUniqueMock,
    },
  },
}));

function createApp() {
  const app = new OpenAPIHono();
  mountGetAdminTask(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function createTask() {
  return {
    id: "0195b9f4-7d35-7a4e-b14e-111111111111",
    createdAt: new Date("2026-03-25T10:00:00.000Z"),
    updatedAt: new Date("2026-03-25T10:00:00.000Z"),
    userId: "user_123",
    user: {
      id: "user_123",
      name: "Ada Lovelace",
      email: "ada@example.com",
      image: null,
    },
    organizationId: "org_123",
    projectId: null,
    organization: { id: "org_123", name: "Acme Corp", slug: "acme-corp" },
    coworkerId: null,
    coworker: null,
    name: "Quarterly report",
    description: null,
    status: TaskStatus.RUNNING,
    events: [],
    jobs: [],
    workspace: {
      id: "11111111-1111-7111-8111-111111111111",
      organizationId: "org_123",
      organization: { id: "org_123", name: "Acme Corp", slug: "acme-corp" },
    },
    share: null,
    linksFrom: [],
    linksTo: [],
  };
}

describe("GET /admin/tasks/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the full task with owner and organization context", async () => {
    taskFindUniqueMock.mockResolvedValue(createTask());
    const app = createApp();

    const response = await app.request(
      "http://localhost/0195b9f4-7d35-7a4e-b14e-111111111111",
    );

    expect(response.status).toBe(200);
    expect(taskFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "0195b9f4-7d35-7a4e-b14e-111111111111" },
      include: expect.objectContaining({
        share: true,
        user: { select: { id: true, name: true, email: true, image: true } },
        organization: { select: { id: true, name: true, slug: true } },
      }),
    });
    const body = await response.json();
    expect(body.data.task).toMatchObject({
      id: "0195b9f4-7d35-7a4e-b14e-111111111111",
      name: "Quarterly report",
      status: TaskStatus.RUNNING,
      userId: "user_123",
      organizationId: "org_123",
      links: [],
    });
    expect(body.data.user).toEqual({
      id: "user_123",
      name: "Ada Lovelace",
      email: "ada@example.com",
    });
    expect(body.data.organization).toEqual({
      id: "org_123",
      name: "Acme Corp",
      slug: "acme-corp",
    });
  });

  it("returns a null organization for personal workspace tasks", async () => {
    const task = createTask();
    taskFindUniqueMock.mockResolvedValue({
      ...task,
      organizationId: null,
      organization: null,
      workspace: { ...task.workspace, organizationId: null },
    });
    const app = createApp();

    const response = await app.request(
      "http://localhost/0195b9f4-7d35-7a4e-b14e-111111111111",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.organization).toBeNull();
  });

  it("returns 404 when the task does not exist", async () => {
    taskFindUniqueMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/tsk_missing");

    expect(response.status).toBe(404);
  });
});
