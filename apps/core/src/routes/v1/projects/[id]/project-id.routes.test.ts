import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountDeleteProject from "./delete.js";
import mountGetProject from "./get.js";
import mountPostProjectJob from "./jobs/post.js";
import mountPatchProject from "./patch.js";

const {
  projectFindFirstMock,
  projectUpdateManyMock,
  projectDeleteManyMock,
  jobFindFirstMock,
  jobUpdateMock,
} = vi.hoisted(() => ({
  projectFindFirstMock: vi.fn(),
  projectUpdateManyMock: vi.fn(),
  projectDeleteManyMock: vi.fn(),
  jobFindFirstMock: vi.fn(),
  jobUpdateMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      findFirst: projectFindFirstMock,
      updateMany: projectUpdateManyMock,
      deleteMany: projectDeleteManyMock,
    },
    job: {
      findFirst: jobFindFirstMock,
      update: jobUpdateMock,
    },
  },
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";

const PROJECT_ID = "22222222-2222-4222-8222-222222222222";

const UNKNOWN_PROJECT_ID = "55555555-5555-4555-8555-555555555555";

const WORKSPACE_CONTEXT = {
  workspaceId: WORKSPACE_ID,
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

const sampleProject = {
  id: PROJECT_ID,
  workspaceId: WORKSPACE_ID,
  name: "P",
  description: null,
  createdAt: new Date("2026-04-03T08:00:00.000Z"),
  updatedAt: new Date("2026-04-03T08:00:00.000Z"),
};

const COWORKER_CONTEXT_AUTH: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: TEST_VENDOR_ID,
  context: { userId: "user_123", organizationId: null },
};

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);

    return await next();
  });

  return app;
}

describe("GET /projects/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when project is missing", async () => {
    projectFindFirstMock.mockResolvedValue(null);
    const app = createApp();
    mountGetProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${UNKNOWN_PROJECT_ID}`);
    expect(res.status).toBe(404);
  });

  it("returns the project when found", async () => {
    projectFindFirstMock.mockResolvedValue(sampleProject);
    const app = createApp();
    mountGetProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(PROJECT_ID);
  });
});

describe("PATCH /projects/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when update matches no row", async () => {
    projectUpdateManyMock.mockResolvedValue({ count: 0 });
    const app = createApp();
    mountPatchProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(404);
  });

  it("returns updated project", async () => {
    projectUpdateManyMock.mockResolvedValue({ count: 1 });
    projectFindFirstMock.mockResolvedValue({
      ...sampleProject,
      name: "New",
    });
    const app = createApp();
    mountPatchProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe("New");
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const app = createApp(COWORKER_CONTEXT_AUTH);
    mountPatchProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hijack" }),
    });
    expect(res.status).toBe(403);
    expect(projectUpdateManyMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /projects/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when nothing deleted", async () => {
    projectDeleteManyMock.mockResolvedValue({ count: 0 });
    const app = createApp();
    mountDeleteProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("returns deleted payload", async () => {
    projectDeleteManyMock.mockResolvedValue({ count: 1 });
    const app = createApp();
    mountDeleteProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const app = createApp(COWORKER_CONTEXT_AUTH);
    mountDeleteProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    expect(projectDeleteManyMock).not.toHaveBeenCalled();
  });
});

describe("POST /projects/{id}/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 409 when job is already in a project", async () => {
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    jobFindFirstMock.mockResolvedValue({
      id: "job_1",
      projectId: "99999999-9999-4999-8999-999999999999",
    });
    const app = createApp();
    mountPostProjectJob(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job_1" }),
    });
    expect(res.status).toBe(409);
  });

  it("returns updated project on success", async () => {
    projectFindFirstMock.mockResolvedValue(sampleProject);
    jobFindFirstMock.mockResolvedValue({ id: "job_1", projectId: null });
    jobUpdateMock.mockResolvedValue({});
    const app = createApp();
    mountPostProjectJob(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job_1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string; name: string } };
    expect(body.data.id).toBe(PROJECT_ID);
    expect(body.data.name).toBe("P");
    expect(jobUpdateMock).toHaveBeenCalledWith({
      where: { id: "job_1" },
      data: {
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
      },
    });
  });

  it("does not update the job when it is already linked to this project", async () => {
    projectFindFirstMock.mockResolvedValue(sampleProject);
    jobFindFirstMock.mockResolvedValue({
      id: "job_1",
      projectId: PROJECT_ID,
    });
    const app = createApp();
    mountPostProjectJob(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job_1" }),
    });
    expect(res.status).toBe(200);
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const app = createApp(COWORKER_CONTEXT_AUTH);
    mountPostProjectJob(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job_1" }),
    });
    expect(res.status).toBe(403);
    expect(jobFindFirstMock).not.toHaveBeenCalled();
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });
});
