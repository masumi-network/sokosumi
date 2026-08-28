import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";
import mountGetProjectContextMd from "./context-md/get.js";
import mountDeleteProject from "./delete.js";
import mountGetProject from "./get.js";
import mountDeleteProjectJob from "./jobs/[jobId]/delete.js";
import mountPostProjectJob from "./jobs/post.js";
import mountPatchProject from "./patch.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  projectFindFirstMock,
  projectUpdateManyMock,
  projectDeleteManyMock,
  jobFindFirstMock,
  jobUpdateMock,
  jobUpdateManyMock,
  deleteProjectBlobsMock,
  deleteProjectBriefingBlobMock,
  ensureProjectFilesTokenMock,
  uploadProjectBriefingFileMock,
} = vi.hoisted(() => ({
  projectFindFirstMock: vi.fn(),
  projectUpdateManyMock: vi.fn(),
  projectDeleteManyMock: vi.fn(),
  jobFindFirstMock: vi.fn(),
  jobUpdateMock: vi.fn(),
  jobUpdateManyMock: vi.fn(),
  deleteProjectBlobsMock: vi.fn(),
  deleteProjectBriefingBlobMock: vi.fn(),
  ensureProjectFilesTokenMock: vi.fn(),
  uploadProjectBriefingFileMock: vi.fn(),
}));

vi.mock("@/lib/project-files-blob", () => ({
  deleteProjectBlobs: deleteProjectBlobsMock,
  deleteProjectBriefingBlob: deleteProjectBriefingBlobMock,
  ensureProjectFilesToken: ensureProjectFilesTokenMock,
  uploadProjectBriefingFile: uploadProjectBriefingFileMock,
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
      updateMany: jobUpdateManyMock,
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
  filesToken: "secret_token",
  websiteUrl: null,
  logo: null,
  designMdUrl: null,
  designMdExtractionId: null,
  briefing: null,
  briefingUrl: null,
  contextMd: null,
  contextMdUrl: null,
  contextMdUpdatedAt: null,
  contextMdModel: null,
  contextMdUpdatingSince: null,
  contextMdVersion: 0,
  projectRevision: 0,
  calendarRevision: 0,
  closingAt: null,
  closedAt: null,
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
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);

    return await next();
  });
  app.onError(errorHandler);

  return app;
}

describe("GET /projects/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when project is missing", async () => {
    projectFindFirstMock.mockResolvedValue(null);
    const app = createApp();
    mountGetProject(app);
    const res = await app.request(`http://localhost/${UNKNOWN_PROJECT_ID}`);
    expect(res.status).toBe(404);
  });

  it("returns the project when found", async () => {
    projectFindFirstMock.mockResolvedValue(sampleProject);
    const app = createApp();
    mountGetProject(app);
    const res = await app.request(`http://localhost/${PROJECT_ID}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(PROJECT_ID);
  });
});

describe("GET /projects/{id}/context-md", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when project has no memory", async () => {
    projectFindFirstMock.mockResolvedValue(sampleProject);
    const app = createApp();
    mountGetProjectContextMd(app);

    const res = await app.request(`http://localhost/${PROJECT_ID}/context-md`);

    expect(res.status).toBe(404);
  });

  it("returns read-only project memory", async () => {
    projectFindFirstMock.mockResolvedValue({
      ...sampleProject,
      contextMd: "# Context\n\nDecision",
      contextMdUrl: "https://blob.example/projects/project_1/CONTEXT.md",
      contextMdUpdatedAt: new Date("2026-04-03T09:00:00.000Z"),
      contextMdModel: "mistral/mistral-medium-latest",
      contextMdVersion: 2,
    });
    const app = createApp();
    mountGetProjectContextMd(app);

    const res = await app.request(`http://localhost/${PROJECT_ID}/context-md`);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        content: string;
        lineCount: number;
        model: { id: string; label: string; region: string };
      };
    };
    expect(body.data).toMatchObject({
      content: "# Context\n\nDecision",
      lineCount: 3,
      model: {
        id: "mistral/mistral-medium-latest",
        label: "Mistral Medium",
        region: "eu",
      },
    });
  });
});

describe("PATCH /projects/{id}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureProjectFilesTokenMock.mockResolvedValue("secret_token");
    uploadProjectBriefingFileMock.mockResolvedValue(
      "https://blob.example/projects/project_1/secret_token/BRIEFING.md",
    );
  });

  it("returns 404 when update matches no row", async () => {
    projectFindFirstMock.mockResolvedValue(sampleProject);
    projectUpdateManyMock.mockResolvedValue({ count: 0 });
    const app = createApp();
    mountPatchProject(app);
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
    mountPatchProject(app);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { name: string } };
    expect(body.data.name).toBe("New");
  });

  it("uploads a briefing before one scoped project update", async () => {
    projectUpdateManyMock.mockResolvedValue({ count: 1 });
    projectFindFirstMock
      .mockResolvedValueOnce(sampleProject)
      .mockResolvedValueOnce({
        ...sampleProject,
        briefing: "Updated briefing",
        briefingUrl:
          "https://blob.example/projects/project_1/secret_token/BRIEFING.md",
      });
    const app = createApp();
    mountPatchProject(app);

    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ briefing: "Updated briefing" }),
    });

    expect(res.status).toBe(200);
    expect(uploadProjectBriefingFileMock).toHaveBeenCalledWith(
      PROJECT_ID,
      "secret_token",
      "Updated briefing",
    );
    expect(projectUpdateManyMock).toHaveBeenCalledOnce();
    expect(projectUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      data: {
        briefing: "Updated briefing",
        briefingUrl:
          "https://blob.example/projects/project_1/secret_token/BRIEFING.md",
      },
    });
  });

  it("clears whitespace-only briefing and deletes its blob", async () => {
    const oldBriefingUrl =
      "https://blob.example/projects/project_1/secret_token/BRIEFING.md";
    projectUpdateManyMock.mockResolvedValue({ count: 1 });
    projectFindFirstMock
      .mockResolvedValueOnce({
        ...sampleProject,
        briefing: "Old briefing",
        briefingUrl: oldBriefingUrl,
      })
      .mockResolvedValueOnce(sampleProject);

    const app = createApp();
    mountPatchProject(app);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ briefing: "   " }),
    });

    expect(res.status).toBe(200);
    expect(uploadProjectBriefingFileMock).not.toHaveBeenCalled();
    expect(projectUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      data: { briefing: null, briefingUrl: null },
    });
    expect(deleteProjectBriefingBlobMock).toHaveBeenCalledWith(oldBriefingUrl);
  });

  it("nulls the URL when a briefing upload fails", async () => {
    const oldBriefingUrl =
      "https://blob.example/projects/project_1/secret_token/BRIEFING.md";
    projectFindFirstMock
      .mockResolvedValueOnce({
        ...sampleProject,
        briefing: "Old briefing",
        briefingUrl: oldBriefingUrl,
      })
      .mockResolvedValueOnce({
        ...sampleProject,
        briefing: "Updated briefing",
        briefingUrl: null,
      });
    projectUpdateManyMock.mockResolvedValue({ count: 1 });
    uploadProjectBriefingFileMock.mockResolvedValue(null);

    const app = createApp();
    mountPatchProject(app);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ briefing: "Updated briefing" }),
    });

    expect(res.status).toBe(200);
    expect(projectUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      data: { briefing: "Updated briefing", briefingUrl: null },
    });
    expect(deleteProjectBriefingBlobMock).toHaveBeenCalledWith(oldBriefingUrl);
  });

  it("does not upload a briefing when the scoped project lookup misses", async () => {
    projectFindFirstMock.mockResolvedValue(null);
    const app = createApp();
    mountPatchProject(app);

    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ briefing: "Unauthorized briefing" }),
    });

    expect(res.status).toBe(404);
    expect(uploadProjectBriefingFileMock).not.toHaveBeenCalled();
    expect(projectUpdateManyMock).not.toHaveBeenCalled();
  });

  it("keeps logo and DESIGN.md when website URL changes", async () => {
    projectUpdateManyMock.mockResolvedValue({ count: 1 });
    projectFindFirstMock.mockResolvedValue({
      ...sampleProject,
      websiteUrl: "https://new.example.com",
    });
    const app = createApp();
    mountPatchProject(app);

    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ websiteUrl: "https://new.example.com" }),
    });

    expect(res.status).toBe(200);
    expect(projectUpdateManyMock).toHaveBeenCalledWith({
      where: { id: PROJECT_ID, workspaceId: WORKSPACE_ID },
      data: { websiteUrl: "https://new.example.com" },
    });
  });

  it("rejects a logo owned by another project", async () => {
    const app = createApp();
    mountPatchProject(app);

    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        logo: "https://abc.public.blob.vercel-storage.com/projects/another-project/logos/hash.png",
      }),
    });

    expect(res.status).toBe(422);
    expect(projectUpdateManyMock).not.toHaveBeenCalled();
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const app = createApp(COWORKER_CONTEXT_AUTH);
    mountPatchProject(app);
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

  it("distinguishes a missing Project from a guarded Project", async () => {
    projectDeleteManyMock.mockResolvedValue({ count: 0 });
    projectFindFirstMock.mockResolvedValue(null);
    const app = createApp();
    mountDeleteProject(app);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
    expect(deleteProjectBlobsMock).not.toHaveBeenCalled();

    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    const guardedResponse = await app.request(
      `http://localhost/${PROJECT_ID}`,
      { method: "DELETE" },
    );
    const guardedBody = (await guardedResponse.json()) as { kind?: string };

    expect(guardedResponse.status).toBe(409);
    expect(guardedBody.kind).toBe("project_has_calendar_history");
    expect(deleteProjectBlobsMock).not.toHaveBeenCalled();
  });

  it("returns deleted payload", async () => {
    projectDeleteManyMock.mockResolvedValue({ count: 1 });
    const app = createApp();
    mountDeleteProject(app);
    const res = await app.request(`http://localhost/${PROJECT_ID}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
    expect(deleteProjectBlobsMock).toHaveBeenCalledWith(PROJECT_ID);
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const app = createApp(COWORKER_CONTEXT_AUTH);
    mountDeleteProject(app);
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
    mountPostProjectJob(app);
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
    mountPostProjectJob(app);
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
    mountPostProjectJob(app);
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
    mountPostProjectJob(app);
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

describe("DELETE /projects/{id}/jobs/{jobId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects coworker context even with X-Context-User-Id", async () => {
    const app = createApp(COWORKER_CONTEXT_AUTH);
    mountDeleteProjectJob(app);
    const res = await app.request(`http://localhost/${PROJECT_ID}/jobs/job_1`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
    expect(projectFindFirstMock).not.toHaveBeenCalled();
    expect(jobUpdateManyMock).not.toHaveBeenCalled();
  });
});
