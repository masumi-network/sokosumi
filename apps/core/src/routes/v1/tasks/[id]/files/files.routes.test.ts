import { OpenAPIHono } from "@hono/zod-openapi";
import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetTaskFiles from "./get";
import mountPostTaskFile from "./post";

const {
  taskFindFirstMock,
  taskFindUniqueMock,
  taskFileCreateMock,
  taskFileFindManyMock,
  coworkerFindFirstMock,
  uploadTaskFileMock,
  deleteTaskFileIfOwnedMock,
  transactionMock,
} = vi.hoisted(() => ({
  taskFindFirstMock: vi.fn(),
  taskFindUniqueMock: vi.fn(),
  taskFileCreateMock: vi.fn(),
  taskFileFindManyMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
  uploadTaskFileMock: vi.fn(),
  deleteTaskFileIfOwnedMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: {
      findFirst: taskFindFirstMock,
      findUnique: taskFindUniqueMock,
    },
    taskFile: {
      create: taskFileCreateMock,
      findMany: taskFileFindManyMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    $transaction: transactionMock,
  },
}));

vi.mock("@/lib/blob", () => ({
  uploadTaskFile: uploadTaskFileMock,
  deleteTaskFileIfOwned: deleteTaskFileIfOwnedMock,
}));

const TASK_ID = "tsk_123";
const OWNER_ID = "user_123";
const COWORKER_ID = "cow_123";
const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";
const FILE_URL =
  "https://abc.public.blob.vercel-storage.com/tasks/tsk_123/report-xyz.pdf";

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

function createUserApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: OWNER_ID,
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: OWNER_ID,
      organizationId: null,
    });
    return await next();
  });

  mountGetTaskFiles(app as unknown as OpenAPIHonoWithAuth);
  mountPostTaskFile(app as unknown as OpenAPIHonoWithAuth);
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

  mountGetTaskFiles(app as unknown as OpenAPIHonoWithAuth);
  mountPostTaskFile(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("task files routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) =>
      fn({
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
      }),
    );
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
        uploader: {
          type: "user",
          id: OWNER_ID,
          user: { id: OWNER_ID, name: "Ada", image: null },
        },
      }),
    ]);
  });

  it("uploads a task file for the owner", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());
    uploadTaskFileMock.mockResolvedValueOnce(FILE_URL);
    taskFileCreateMock.mockResolvedValueOnce({
      id: "tfile_1",
      taskId: TASK_ID,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      name: "report.pdf",
      fileUrl: FILE_URL,
      mimeType: "application/pdf",
      size: 11n,
      uploadedByUserId: OWNER_ID,
      uploadedByCoworkerId: null,
      uploadedByUser: {
        id: OWNER_ID,
        name: "Ada",
        image: null,
      },
      uploadedByCoworker: null,
    });

    const form = new FormData();
    form.append(
      "file",
      new File(["hello world"], "report.pdf", { type: "application/pdf" }),
    );

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: "tfile_1",
      fileUrl: FILE_URL,
      mimeType: "application/pdf",
      uploader: { type: "user", id: OWNER_ID },
    });
    expect(uploadTaskFileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: TASK_ID,
        contentType: "application/pdf",
        filename: "report.pdf",
      }),
    );
  });

  it("allows assigned coworker to upload", async () => {
    coworkerFindFirstMock.mockResolvedValueOnce({
      id: COWORKER_ID,
      slug: "ops",
      baseURL: null,
    });
    taskFindUniqueMock.mockResolvedValueOnce(ownedTask());
    uploadTaskFileMock.mockResolvedValueOnce(FILE_URL);
    taskFileCreateMock.mockResolvedValueOnce({
      id: "tfile_2",
      taskId: TASK_ID,
      createdAt: new Date("2026-07-01T00:00:00.000Z"),
      updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      name: "notes.txt",
      fileUrl: FILE_URL,
      mimeType: "text/plain",
      size: 5n,
      uploadedByUserId: null,
      uploadedByCoworkerId: COWORKER_ID,
      uploadedByUser: null,
      uploadedByCoworker: {
        id: COWORKER_ID,
        name: "Ops",
        image: null,
        slug: "ops",
      },
    });

    const form = new FormData();
    form.append(
      "file",
      new File(["notes"], "notes.txt", { type: "text/plain" }),
    );

    const app = createCoworkerApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.uploader).toEqual({
      type: "coworker",
      id: COWORKER_ID,
      coworker: {
        id: COWORKER_ID,
        name: "Ops",
        image: null,
        slug: "ops",
      },
    });
  });

  it("rejects unassigned coworker upload", async () => {
    coworkerFindFirstMock.mockResolvedValueOnce({
      id: "cow_other",
      slug: "other",
      baseURL: null,
    });
    taskFindUniqueMock.mockResolvedValueOnce(ownedTask());

    const form = new FormData();
    form.append(
      "file",
      new File(["notes"], "notes.txt", { type: "text/plain" }),
    );

    const app = createCoworkerApp("cow_other");
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(403);
    expect(uploadTaskFileMock).not.toHaveBeenCalled();
  });

  it("rejects empty file", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());

    const form = new FormData();
    form.append("file", new File([], "empty.pdf", { type: "application/pdf" }));

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(400);
  });

  it("returns 503 when blob upload fails", async () => {
    taskFindFirstMock.mockResolvedValueOnce(ownedTask());
    uploadTaskFileMock.mockResolvedValueOnce(null);

    const form = new FormData();
    form.append(
      "file",
      new File(["hello"], "report.pdf", { type: "application/pdf" }),
    );

    const app = createUserApp();
    const response = await app.request(`http://localhost/${TASK_ID}/files`, {
      method: "POST",
      body: form,
    });

    expect(response.status).toBe(503);
  });
});
