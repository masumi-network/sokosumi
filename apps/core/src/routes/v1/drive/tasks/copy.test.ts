import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext, AuthVariables } from "@/middleware/auth";
import mountCopy from "./copy";

const {
  prismaTaskFileFindUniqueMock,
  requireTaskReadForRouteVarsMock,
  requireUserDriveFileUploadAccessMock,
  requireOrganizationDriveFileUploadAccessMock,
  ssrfSafeFetchMock,
  headMock,
  listMock,
  putMock,
} = vi.hoisted(() => ({
  prismaTaskFileFindUniqueMock: vi.fn(),
  requireTaskReadForRouteVarsMock: vi.fn(),
  requireUserDriveFileUploadAccessMock: vi.fn(),
  requireOrganizationDriveFileUploadAccessMock: vi.fn(),
  ssrfSafeFetchMock: vi.fn(),
  headMock: vi.fn(),
  listMock: vi.fn(),
  putMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    taskFile: {
      findUnique: prismaTaskFileFindUniqueMock,
    },
  },
}));

vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadForRouteVarsMock,
}));

vi.mock("@/helpers/drive-file-access", () => ({
  requireUserDriveFileUploadAccess: requireUserDriveFileUploadAccessMock,
  requireOrganizationDriveFileUploadAccess:
    requireOrganizationDriveFileUploadAccessMock,
}));

vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: ssrfSafeFetchMock,
}));

vi.mock("@vercel/blob", () => ({
  head: headMock,
  list: listMock,
  put: putMock,
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BLOB_READ_WRITE_TOKEN: "test-token",
    }),
  };
});

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = USER_AUTH_CONTEXT) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("requestId", "req_123");
    await next();
  });

  mountCopy(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("POST /v1/drive/tasks/copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("copies TaskFile to personal Drive root", async () => {
    const taskFile = {
      id: "tf_123",
      name: "document.pdf",
      fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
      size: BigInt(1024),
      mimeType: "application/pdf",
      task: {
        id: "tsk_1",
      },
    };

    prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    // BlobNotFoundError for no collision
    const BlobNotFoundError = (await import("@vercel/blob")).BlobNotFoundError;
    headMock.mockRejectedValue(new BlobNotFoundError());
    listMock.mockResolvedValue({
      blobs: [],
      hasMore: false,
      cursor: undefined,
    });

    const arrayBuffer = new ArrayBuffer(1024);
    ssrfSafeFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    });

    putMock.mockResolvedValue({
      url: "https://blob.example/drive/users/user_123/document.pdf",
      pathname: "drive/users/user_123/document.pdf",
      downloadUrl: "https://blob.example/drive/users/user_123/document.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
      etag: "etag123",
    });

    const app = createApp();
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "me",
      }),
    });

    expect(res.status).toBe(201);
    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
      expect.anything(),
      "tsk_1",
    );
    expect(requireUserDriveFileUploadAccessMock).toHaveBeenCalled();

    const json = await res.json();
    expect(json.data).toMatchObject({
      name: "document.pdf",
      pathname: "drive/users/user_123/document.pdf",
    });

    // Verify source fetch was called
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(
      "https://blob.example/tasks/tsk_1/document.pdf",
    );
  });

  it("copies TaskFile to org Drive root", async () => {
    const taskFile = {
      id: "tf_123",
      name: "document.pdf",
      fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
      size: BigInt(1024),
      mimeType: "application/pdf",
      task: {
        id: "tsk_1",
      },
    };

    prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);
    requireOrganizationDriveFileUploadAccessMock.mockResolvedValue(undefined);

    const BlobNotFoundError = (await import("@vercel/blob")).BlobNotFoundError;
    headMock.mockRejectedValue(new BlobNotFoundError());
    listMock.mockResolvedValue({
      blobs: [],
      hasMore: false,
      cursor: undefined,
    });

    const arrayBuffer = new ArrayBuffer(1024);
    ssrfSafeFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    });

    putMock.mockResolvedValue({
      url: "https://blob.example/drive/organizations/org_123/document.pdf",
      pathname: "drive/organizations/org_123/document.pdf",
      downloadUrl:
        "https://blob.example/drive/organizations/org_123/document.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
    });

    const app = createApp();
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "org",
        organizationId: "org_123",
      }),
    });

    expect(res.status).toBe(201);
    expect(requireOrganizationDriveFileUploadAccessMock).toHaveBeenCalledWith(
      expect.anything(),
      "org_123",
    );
  });

  it("returns 404 when TaskFile not found", async () => {
    prismaTaskFileFindUniqueMock.mockResolvedValue(null);

    const app = createApp();
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskFileId: "tf_missing",
        scope: "me",
      }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 409 when dest file already exists", async () => {
    const taskFile = {
      id: "tf_123",
      name: "document.pdf",
      fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
      size: BigInt(1024),
      mimeType: "application/pdf",
      task: {
        id: "tsk_1",
      },
    };

    prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    // File exists
    headMock.mockResolvedValue({
      url: "https://blob.example/drive/users/user_123/document.pdf",
      size: 1024,
      uploadedAt: new Date(),
      pathname: "drive/users/user_123/document.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
    });

    const app = createApp();
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "me",
      }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.message).toContain("already exists");
  });

  it("returns 409 when dest folder with same name exists", async () => {
    const taskFile = {
      id: "tf_123",
      name: "document.pdf",
      fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
      size: BigInt(1024),
      mimeType: "application/pdf",
      task: {
        id: "tsk_1",
      },
    };

    prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    const BlobNotFoundError = (await import("@vercel/blob")).BlobNotFoundError;
    headMock.mockRejectedValue(new BlobNotFoundError());

    // Folder exists
    listMock.mockResolvedValue({
      blobs: [
        {
          url: "https://blob.example/drive/users/user_123/document.pdf/__drive_folder__",
          pathname: "drive/users/user_123/document.pdf/__drive_folder__",
          size: 0,
          uploadedAt: new Date(),
          downloadUrl:
            "https://blob.example/drive/users/user_123/document.pdf/__drive_folder__",
        },
      ],
      hasMore: false,
      cursor: null,
    });

    const app = createApp();
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "me",
      }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.message).toContain("folder");
  });

  it("sanitizes file name for Drive", async () => {
    const taskFile = {
      id: "tf_123",
      name: "../../../evil.pdf",
      fileUrl: "https://blob.example/tasks/tsk_1/file.pdf",
      size: BigInt(1024),
      mimeType: "application/pdf",
      task: {
        id: "tsk_1",
      },
    };

    prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    const BlobNotFoundError = (await import("@vercel/blob")).BlobNotFoundError;
    headMock.mockRejectedValue(new BlobNotFoundError());
    listMock.mockResolvedValue({
      blobs: [],
      hasMore: false,
      cursor: undefined,
    });

    const arrayBuffer = new ArrayBuffer(1024);
    ssrfSafeFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    });

    putMock.mockResolvedValue({
      url: "https://blob.example/drive/users/user_123/evil.pdf",
      pathname: "drive/users/user_123/evil.pdf",
      downloadUrl: "https://blob.example/drive/users/user_123/evil.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
    });

    const app = createApp();
    const res = await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "me",
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    // Sanitized: "../../../evil.pdf" → "evil.pdf"
    expect(json.data.name).toBe("evil.pdf");
  });

  it("leaves source TaskFile unchanged", async () => {
    const taskFile = {
      id: "tf_123",
      name: "document.pdf",
      fileUrl: "https://blob.example/tasks/tsk_1/document.pdf",
      size: BigInt(1024),
      mimeType: "application/pdf",
      task: {
        id: "tsk_1",
      },
    };

    prismaTaskFileFindUniqueMock.mockResolvedValue(taskFile);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    const BlobNotFoundError = (await import("@vercel/blob")).BlobNotFoundError;
    headMock.mockRejectedValue(new BlobNotFoundError());
    listMock.mockResolvedValue({
      blobs: [],
      hasMore: false,
      cursor: undefined,
    });

    const arrayBuffer = new ArrayBuffer(1024);
    ssrfSafeFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(arrayBuffer),
    });

    putMock.mockResolvedValue({
      url: "https://blob.example/drive/users/user_123/document.pdf",
      pathname: "drive/users/user_123/document.pdf",
      downloadUrl: "https://blob.example/drive/users/user_123/document.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
      etag: "etag123",
    });

    const app = createApp();
    await app.request("http://localhost/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "me",
      }),
    });

    // Verify source blob was fetched but not modified
    expect(ssrfSafeFetchMock).toHaveBeenCalledWith(taskFile.fileUrl);
    // Put creates new blob, doesn't touch source
    expect(putMock).toHaveBeenCalledWith(
      "drive/users/user_123/document.pdf",
      arrayBuffer,
      expect.objectContaining({
        access: "public",
        addRandomSuffix: false,
      }),
    );
  });
});
