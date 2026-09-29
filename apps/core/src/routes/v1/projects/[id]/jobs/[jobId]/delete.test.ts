import { TaskVisibility } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { buildHumanJobParentVisibilityWhere } from "@/helpers/task-visibility";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";
import {
  matchesJobParentVisibility,
  type StoredParentTask,
} from "@/test-fixtures/job-parent-visibility";

import mountDeleteProjectJob from "./delete.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { jobUpdateManyMock, projectFindFirstMock } = vi.hoisted(() => ({
  jobUpdateManyMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: projectFindFirstMock },
    job: { updateMany: jobUpdateManyMock },
  },
}));

const OWNER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const OTHER_MEMBER_AUTH_CONTEXT: AuthenticationContext = {
  ...OWNER_AUTH_CONTEXT,
  userId: "user_456",
};

const WORKSPACE_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "job_abc";

const WORKSPACE_CONTEXT = {
  workspaceId: WORKSPACE_ID,
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

const PRIVATE_TASK: StoredParentTask = {
  visibility: TaskVisibility.PRIVATE,
  ownerId: "user_123",
};

const PUBLIC_TASK: StoredParentTask = {
  visibility: TaskVisibility.PUBLIC,
  ownerId: "user_123",
};

function updateManyVisibleJob(parentTask: StoredParentTask | null) {
  return async ({
    where,
  }: {
    where: Parameters<typeof matchesJobParentVisibility>[1];
  }) => ({ count: matchesJobParentVisibility(parentTask, where) ? 1 : 0 });
}

function deleteJob(authContext: AuthenticationContext) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);
    return await next();
  });
  mountDeleteProjectJob(app);

  return app.request(`http://localhost/${PROJECT_ID}/jobs/${JOB_ID}`, {
    method: "DELETE",
  });
}

describe("DELETE /projects/{id}/jobs/{jobId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      name: "P",
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
      latestUpdateMd: null,
      latestUpdateMdUpdatedAt: null,
      createdAt: new Date("2026-04-03T08:00:00.000Z"),
      updatedAt: new Date("2026-04-03T08:00:00.000Z"),
    });
  });

  it("lets the owner remove a Job under their private Task", async () => {
    jobUpdateManyMock.mockImplementation(updateManyVisibleJob(PRIVATE_TASK));

    const response = await deleteJob(OWNER_AUTH_CONTEXT);

    expect(response.status).toBe(200);
    expect(jobUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: JOB_ID,
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        ...buildHumanJobParentVisibilityWhere("user_123"),
      },
      data: { projectId: null },
    });
  });

  it("returns 404 when another member removes a Job under a private Task", async () => {
    jobUpdateManyMock.mockImplementation(updateManyVisibleJob(PRIVATE_TASK));

    const response = await deleteJob(OTHER_MEMBER_AUTH_CONTEXT);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      message: "Project or job link not found",
    });
  });

  it("lets any member remove a Job under a public Task", async () => {
    jobUpdateManyMock.mockImplementation(updateManyVisibleJob(PUBLIC_TASK));

    const response = await deleteJob(OTHER_MEMBER_AUTH_CONTEXT);

    expect(response.status).toBe(200);
  });

  it("lets any member remove a Job with no Task", async () => {
    jobUpdateManyMock.mockImplementation(updateManyVisibleJob(null));

    const response = await deleteJob(OTHER_MEMBER_AUTH_CONTEXT);

    expect(response.status).toBe(200);
  });
});
