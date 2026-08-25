import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { TASK_FILE_MAX_SIZE_BYTES } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetTaskFiles from "./get";
import mountPostTaskFile from "./post";

const {
  taskFindFirstMock,
  taskFindUniqueMock,
  taskFileFindManyMock,
  coworkerFindFirstMock,
  createTaskFileUploadSessionMock,
  getEnvMock,
} = vi.hoisted(() => ({
  taskFindFirstMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
  taskFileFindManyMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  createTaskFileUploadSessionMock: vi.fn(),
  getEnvMock: vi.fn(),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => {
      const base = actual.getEnv();
      return {
        ...base,
        ...getEnvMock(),
      };
    },
    getBetterAuthPublicBaseUrl: () => "https://core.example.com",
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findFirst: taskFindFirstMock,
      findUnique: taskFindUniqueMock,
    },
    taskFile: {
      findMany: taskFileFindManyMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
  },
}));

vi.mock("@/lib/blob", () => ({
  createTaskFileUploadSession: (...args: unknown[]) =>
    createTaskFileUploadSessionMock(...args),
}));

const TASK_ID = "tsk_123";
const OWNER_ID = "user_123";
const COWORKER_ID = "cow_123";
const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const FILE_URL =
  "https://abc.public.blob.vercel-storage.com/tasks/tsk_123/report-xyz.pdf";

const UPLOAD_SESSION = {
  uploadUrl: "https://blob.example/upload?sig=1",
  pathname: "tasks/tsk_123/report.pdf",
  access: "public" as const,
  method: "PUT" as const,
  headers: { "Content-Type": "application/pdf" },
  expiresAt: "2026-07-30T12:15:00.000Z",
  maxSizeBytes: TASK_FILE_MAX_SIZE_BYTES,
  addRandomSuffix: true,
};

function ownedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    ownerId: OWNER_ID,
    assigneeId: COWORKER_ID,
    status: TaskStatus.READY,
    archivedAt: null,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  };
}

function mountFiles(app: OpenAPIHonoWithAuth) {
  mountGetTaskFiles(app);
  mountPostTaskFile(app);
}

function createUserApp(userId = OWNER_ID) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId,
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId,
      organizationId: null,
    });
    return await next();
  });

  mountFiles(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function createCoworkerApp(assigneeId = COWORKER_ID) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "coworker",
      coworkerId: assigneeId,
      vendorId: "11111111-1111-7111-8111-111111111111",
    });
    c.set("workspaceContext", null);
    return await next();
  });

  mountFiles(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("task files routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: "blob-token",
      BLOB_WEBHOOK_PUBLIC_KEY:
        "-----BEGIN PUBLIC KEY-----\ntest\n-----END PUBLIC KEY-----",
    } as ReturnType<typeof getEnvMock>);
    createTaskFileUploadSessionMock.mockResolvedValue(UPLOAD_SESSION);
  });

  it("lists task files for the owner", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());
    taskFileFindManyMock.mockResolvedValueOnce([
      {
        id: "tfile_1",
        taskId: TASK_ID,
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
        name: "report.pdf",
        fileUrl: FILE_URL,
        sourceUrl: null,
        status: "READY",
        origin: "USER_UPLOAD",
        mimeType: "application/pdf",
        size: 123n,
        uploadedByUserId: OWNER_ID,
        uploadedByCoworkerId: null,
        uploadedByUser: {
          id: OWNER_ID,
          name: "Ada",
          image: null,
        },
        uploadedByCoworker: null,
      },
    ]);

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        id: "tfile_1",
        name: "report.pdf",
        fileUrl: FILE_URL,
        size: 123,
      }),
    ]);
  });

  it("mints an upload session for the owner with completion callback", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 11,
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({
      uploadUrl: UPLOAD_SESSION.uploadUrl,
      method: "PUT",
      pathname: UPLOAD_SESSION.pathname,
    });
    expect(createTaskFileUploadSessionMock).toHaveBeenCalledWith(
      TASK_ID,
      {
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 11,
        maxSizeBytes: TASK_FILE_MAX_SIZE_BYTES,
      },
      "blob-token",
      {
        uploadedByUserId: OWNER_ID,
        uploadedByCoworkerId: null,
        callbackUrl:
          "https://core.example.com/v1/webhooks/tasks/files/uploaded",
      },
    );
  });

  it("mints for assigned coworker with coworker uploader id", async () => {
    coworkerFindFirstMock.mockResolvedValueOnce({
      id: COWORKER_ID,
      slug: "ops",
      baseURL: null,
    });
    taskFindUniqueMock.mockResolvedValueOnce(ownedTask());

    const app = createCoworkerApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "notes.txt",
        contentType: "text/plain",
        size: 5,
      }),
    });

    expect(response.status).toBe(201);
    expect(createTaskFileUploadSessionMock).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({
        filename: "notes.txt",
        contentType: "text/plain",
      }),
      "blob-token",
      {
        uploadedByUserId: null,
        uploadedByCoworkerId: COWORKER_ID,
        callbackUrl:
          "https://core.example.com/v1/webhooks/tasks/files/uploaded",
      },
    );
  });

  it("rejects unassigned coworker mint", async () => {
    coworkerFindFirstMock.mockResolvedValueOnce({
      id: "cow_other",
      slug: "other",
      baseURL: null,
    });
    taskFindUniqueMock.mockResolvedValueOnce(ownedTask());

    const app = createCoworkerApp("cow_other");
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "notes.txt",
        contentType: "text/plain",
        size: 5,
      }),
    });

    expect(response.status).toBe(403);
    expect(createTaskFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 503 when blob token is missing", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: "",
      BLOB_WEBHOOK_PUBLIC_KEY: "key",
    } as ReturnType<typeof getEnvMock>);

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 11,
      }),
    });

    expect(response.status).toBe(503);
    expect(createTaskFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("returns 503 when webhook public key is missing", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());
    getEnvMock.mockReturnValue({
      BLOB_READ_WRITE_TOKEN: "blob-token",
      BLOB_WEBHOOK_PUBLIC_KEY: undefined,
    } as ReturnType<typeof getEnvMock>);

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 11,
      }),
    });

    expect(response.status).toBe(503);
    expect(createTaskFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("rejects unsupported content types on mint", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "malware.exe",
        contentType: "application/x-msdownload",
        size: 11,
      }),
    });

    expect(response.status).toBe(400);
    expect(createTaskFileUploadSessionMock).not.toHaveBeenCalled();
  });

  it("rejects SVG on mint", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "icon.svg",
        contentType: "image/svg+xml",
        size: 11,
      }),
    });

    expect(response.status).toBe(400);
  });

  it("rejects mint when the task is parked", async () => {
    taskFindFirstMock.mockResolvedValueOnce(
      ownedTask({ status: TaskStatus.GRANT_PENDING }),
    );

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "report.pdf",
        contentType: "application/pdf",
        size: 11,
      }),
    });

    expect(response.status).toBe(403);
  });

  it("rejects mint over the 50 MB limit", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "big.pdf",
        contentType: "application/pdf",
        size: TASK_FILE_MAX_SIZE_BYTES + 1,
      }),
    });

    expect(response.status).toBe(413);
  });

  it("clamps long display names on mint", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());
    const longName = `${"a".repeat(300)}.pdf`;
    const clampedName = `${"a".repeat(251)}.pdf`;

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: longName,
        contentType: "application/pdf",
        size: 4,
      }),
    });

    expect(response.status).toBe(201);
    expect(createTaskFileUploadSessionMock).toHaveBeenCalledWith(
      TASK_ID,
      expect.objectContaining({ filename: clampedName }),
      "blob-token",
      expect.any(Object),
    );
  });
});
