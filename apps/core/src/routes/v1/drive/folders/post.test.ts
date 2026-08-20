import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import mountPost from "./post";

// Mock @vercel/blob
vi.mock("@vercel/blob", () => ({
  head: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));

// Mock drive file access
vi.mock("@/helpers/drive-file-access", () => ({
  requireUserDriveFileUploadAccess: vi.fn(),
  requireOrganizationDriveFileUploadAccess: vi.fn(),
}));

// Mock env
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BLOB_READ_WRITE_TOKEN: "test-token",
      STRIPE_SECRET_KEY: "sk_test_123",
    }),
  };
});

import { head, list, put } from "@vercel/blob";
import { requireUserDriveFileUploadAccess } from "@/helpers/drive-file-access";

const headMock = vi.mocked(head);
const listMock = vi.mocked(list);
const putMock = vi.mocked(put);
const requireUserDriveFileUploadAccessMock = vi.mocked(
  requireUserDriveFileUploadAccess,
);

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & { requestId: string };
  }>();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);

    return await next();
  });

  return app;
}

describe("POST /v1/drive/folders (create folder)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects 'Tasks' as root folder name (reserved)", async () => {
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    const app = createApp();
    mountPost(app as unknown as OpenAPIHonoWithAuth);

    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        folderPath: "Tasks",
        scope: "me",
      }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.message).toContain("reserved");
    expect(json.message).toContain("Tasks");
  });

  it("rejects 'Tasks' nested in path (root segment check)", async () => {
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    const app = createApp();
    mountPost(app as unknown as OpenAPIHonoWithAuth);

    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        folderPath: "Tasks/SubFolder",
        scope: "me",
      }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.message).toContain("reserved");
  });

  it("allows 'Tasks' as non-root segment", async () => {
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    listMock.mockResolvedValue({ blobs: [] });
    headMock.mockRejectedValue({ statusCode: 404 });
    putMock.mockResolvedValue({
      url: "https://example.com/drive/users/user_123/Projects/Tasks/__drive_folder__",
      pathname: "drive/users/user_123/Projects/Tasks/__drive_folder__",
    });

    const app = createApp();
    mountPost(app as unknown as OpenAPIHonoWithAuth);

    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        folderPath: "Projects/Tasks",
        scope: "me",
      }),
    });

    expect(res.status).toBe(201);
  });

  it("allows folder names other than 'Tasks'", async () => {
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    listMock.mockResolvedValue({ blobs: [] });
    headMock.mockRejectedValue({ statusCode: 404 });
    putMock.mockResolvedValue({
      url: "https://example.com/drive/users/user_123/Documents/__drive_folder__",
      pathname: "drive/users/user_123/Documents/__drive_folder__",
    });

    const app = createApp();
    mountPost(app as unknown as OpenAPIHonoWithAuth);

    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        folderPath: "Documents",
        scope: "me",
      }),
    });

    expect(res.status).toBe(201);
  });
});
