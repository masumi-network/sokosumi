import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountDeleteProject from "./delete.js";
import mountGetProject from "./get.js";
import mountPostProjectJob from "./jobs/post.js";
import mountPatchProject from "./patch.js";

const {
  findByIdInWorkspaceMock,
  updateInWorkspaceMock,
  deleteInWorkspaceMock,
  addJobMock,
} = vi.hoisted(() => ({
  findByIdInWorkspaceMock: vi.fn(),
  updateInWorkspaceMock: vi.fn(),
  deleteInWorkspaceMock: vi.fn(),
  addJobMock: vi.fn(),
}));

vi.mock("@/lib/repository", () => ({
  findProjectByIdInWorkspace: findByIdInWorkspaceMock,
  updateProjectInWorkspace: updateInWorkspaceMock,
  deleteProjectInWorkspace: deleteInWorkspaceMock,
  addJobToProject: addJobMock,
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
  jobs: [] as { id: string }[],
  tasks: [] as { id: string }[],
};

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", USER_AUTH_CONTEXT);
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
    findByIdInWorkspaceMock.mockResolvedValue(null);
    const app = createApp();
    mountGetProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${UNKNOWN_PROJECT_ID}`);
    expect(res.status).toBe(404);
  });

  it("returns the project when found", async () => {
    findByIdInWorkspaceMock.mockResolvedValue(sampleProject);
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
    updateInWorkspaceMock.mockResolvedValue(null);
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
    updateInWorkspaceMock.mockResolvedValue({
      ...sampleProject,
      name: "New",
    });
    findByIdInWorkspaceMock.mockResolvedValue({
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
});

describe("DELETE /projects/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when nothing deleted", async () => {
    deleteInWorkspaceMock.mockResolvedValue(false);
    const app = createApp();
    mountDeleteProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });

  it("returns deleted payload", async () => {
    deleteInWorkspaceMock.mockResolvedValue(true);
    const app = createApp();
    mountDeleteProject(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });
});

describe("POST /projects/{id}/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 409 when job is already in a project", async () => {
    addJobMock.mockResolvedValue({
      ok: false,
      reason: "job_already_in_project",
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
    addJobMock.mockResolvedValue({ ok: true });
    findByIdInWorkspaceMock.mockResolvedValue({
      ...sampleProject,
      jobs: [{ id: "job_1" }],
    });
    const app = createApp();
    mountPostProjectJob(app as unknown as OpenAPIHonoWithAuth);
    const res = await app.request(`http://localhost/${PROJECT_ID}/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: "job_1" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { jobIds: string[] } };
    expect(body.data.jobIds).toEqual(["job_1"]);
  });
});
