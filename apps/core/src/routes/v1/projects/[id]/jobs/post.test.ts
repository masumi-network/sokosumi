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

import mountPostProjectJob from "./post.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { jobFindFirstMock, jobUpdateMock, projectFindFirstMock } = vi.hoisted(
  () => ({
    jobFindFirstMock: vi.fn(),
    jobUpdateMock: vi.fn(),
    projectFindFirstMock: vi.fn(),
  }),
);

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: projectFindFirstMock },
    job: { findFirst: jobFindFirstMock, update: jobUpdateMock },
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

function findFirstVisibleJob(parentTask: StoredParentTask | null) {
  return async ({
    where,
  }: {
    where: Parameters<typeof matchesJobParentVisibility>[1];
  }) =>
    matchesJobParentVisibility(parentTask, where) ? { projectId: null } : null;
}

function postJob(authContext: AuthenticationContext) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);
    return await next();
  });
  mountPostProjectJob(app);

  return app.request(`http://localhost/${PROJECT_ID}/jobs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: JOB_ID }),
  });
}

describe("POST /projects/{id}/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    projectFindFirstMock.mockResolvedValue({
      id: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      name: "P",
      websiteUrl: null,
      identifier: "SOK",
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
    jobUpdateMock.mockResolvedValue({});
  });

  it("lets the owner add a Job under their private Task", async () => {
    jobFindFirstMock.mockImplementation(findFirstVisibleJob(PRIVATE_TASK));

    const response = await postJob(OWNER_AUTH_CONTEXT);

    expect(response.status).toBe(200);
    expect(jobFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: JOB_ID,
          workspaceId: WORKSPACE_ID,
          ...buildHumanJobParentVisibilityWhere("user_123"),
        },
      }),
    );
    expect(jobUpdateMock).toHaveBeenCalledWith({
      where: { id: JOB_ID },
      data: { projectId: PROJECT_ID, workspaceId: WORKSPACE_ID },
    });
  });

  it("returns 404 when another member adds a Job under a private Task", async () => {
    jobFindFirstMock.mockImplementation(findFirstVisibleJob(PRIVATE_TASK));

    const response = await postJob(OTHER_MEMBER_AUTH_CONTEXT);

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ message: "Job not found" });
    expect(jobUpdateMock).not.toHaveBeenCalled();
  });

  it("lets any member add a Job under a public Task", async () => {
    jobFindFirstMock.mockImplementation(findFirstVisibleJob(PUBLIC_TASK));

    const response = await postJob(OTHER_MEMBER_AUTH_CONTEXT);

    expect(response.status).toBe(200);
    expect(jobUpdateMock).toHaveBeenCalledOnce();
  });

  it("lets any member add a Job with no Task", async () => {
    jobFindFirstMock.mockImplementation(findFirstVisibleJob(null));

    const response = await postJob(OTHER_MEMBER_AUTH_CONTEXT);

    expect(response.status).toBe(200);
    expect(jobUpdateMock).toHaveBeenCalledOnce();
  });
});
