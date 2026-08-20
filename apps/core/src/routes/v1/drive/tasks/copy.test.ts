import { beforeEach, describe, expect, it, vi } from "vitest";

import mountCopy from "./copy";

// Mock Prisma
const mockPrismaClient = {
  taskFile: {
    findUnique: vi.fn(),
  },
};

vi.mock("@/lib/db/prisma", () => ({
  default: mockPrismaClient,
}));

// Mock @vercel/blob
vi.mock("@vercel/blob", () => ({
  head: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
}));

// Mock @sokosumi/net
vi.mock("@sokosumi/net", () => ({
  ssrfSafeFetch: vi.fn(),
}));

// Mock access control
vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: vi.fn(),
}));

// Mock coworker user context binding
vi.mock("@/helpers/coworker-user-context-binding", () => ({
  requireAuthorizedUserContext: vi.fn(),
}));

// Mock drive file access
vi.mock("@/helpers/drive-file-access", () => ({
  requireUserDriveFileUploadAccess: vi.fn(),
  requireOrganizationDriveFileUploadAccess: vi.fn(),
}));

// Mock env
vi.mock("@/config/env", () => ({
  getEnv: () => ({
    BLOB_READ_WRITE_TOKEN: "test-token",
  }),
}));

import { ssrfSafeFetch } from "@sokosumi/net";
import { head, list, put } from "@vercel/blob";
import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { requireAuthorizedUserContext } from "@/helpers/coworker-user-context-binding";
import {
  requireOrganizationDriveFileUploadAccess,
  requireUserDriveFileUploadAccess,
} from "@/helpers/drive-file-access";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

const mockPrisma = mockPrismaClient;
const headMock = vi.mocked(head);
const listMock = vi.mocked(list);
const putMock = vi.mocked(put);
const ssrfSafeFetchMock = vi.mocked(ssrfSafeFetch);
const requireTaskReadForRouteVarsMock = vi.mocked(requireTaskReadForRouteVars);
const requireAuthorizedUserContextMock = vi.mocked(
  requireAuthorizedUserContext,
);
const requireUserDriveFileUploadAccessMock = vi.mocked(
  requireUserDriveFileUploadAccess,
);
const requireOrganizationDriveFileUploadAccessMock = vi.mocked(
  requireOrganizationDriveFileUploadAccess,
);

describe("POST /v1/drive/tasks/copy", () => {
  let app: OpenAPIHonoWithAuth;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new OpenAPIHonoWithAuth();
    mountCopy(app);
  });

  it("copies a TaskFile to personal Drive root", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

    mockPrisma.taskFile.findUnique = vi.fn().mockResolvedValue({
      id: "tf_123",
      name: "report.pdf",
      fileUrl: "https://example.com/tasks/report.pdf",
      mimeType: "application/pdf",
      size: BigInt(2048),
      task: {
        id: "tsk_456",
        workspaceId: "ws_personal",
      },
    });

    // head returns 404 (file does not exist)
    headMock.mockRejectedValue({
      statusCode: 404,
    });

    // list returns empty (no folder collision)
    listMock.mockResolvedValue({
      blobs: [],
    });

    // ssrfSafeFetch succeeds
    ssrfSafeFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(2048),
    });

    // put succeeds
    putMock.mockResolvedValue({
      url: "https://example.com/drive/users/user_123/report.pdf",
      pathname: "drive/users/user_123/report.pdf",
    });

    const res = await app.request("/copy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "me",
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toMatchObject({
      name: "report.pdf",
      fileUrl: "https://example.com/drive/users/user_123/report.pdf",
      pathname: "drive/users/user_123/report.pdf",
    });

    expect(requireTaskReadForRouteVarsMock).toHaveBeenCalledWith(
      expect.anything(),
      "tsk_456",
    );
    expect(headMock).toHaveBeenCalledWith(
      "drive/users/user_123/report.pdf",
      expect.objectContaining({ token: "test-token" }),
    );
    expect(putMock).toHaveBeenCalledWith(
      "drive/users/user_123/report.pdf",
      expect.any(ArrayBuffer),
      expect.objectContaining({
        token: "test-token",
        access: "public",
        addRandomSuffix: false,
        contentType: "application/pdf",
      }),
    );
  });

  it("copies a TaskFile to organization Drive root", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireOrganizationDriveFileUploadAccessMock.mockResolvedValue({
      id: "org_456",
      name: "Test Org",
    });
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

    mockPrisma.taskFile.findUnique = vi.fn().mockResolvedValue({
      id: "tf_123",
      name: "design.png",
      fileUrl: "https://example.com/tasks/design.png",
      mimeType: "image/png",
      size: BigInt(4096),
      task: {
        id: "tsk_789",
        workspaceId: "ws_org",
      },
    });

    headMock.mockRejectedValue({ statusCode: 404 });
    listMock.mockResolvedValue({ blobs: [] });
    ssrfSafeFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4096),
    });
    putMock.mockResolvedValue({
      url: "https://example.com/drive/organizations/org_456/design.png",
      pathname: "drive/organizations/org_456/design.png",
    });

    const res = await app.request("/copy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "org",
        organizationId: "org_456",
      }),
    });

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toMatchObject({
      name: "design.png",
      fileUrl: "https://example.com/drive/organizations/org_456/design.png",
      pathname: "drive/organizations/org_456/design.png",
    });

    expect(requireOrganizationDriveFileUploadAccessMock).toHaveBeenCalledWith(
      expect.anything(),
      "org_456",
    );
  });

  it("returns 404 when TaskFile not found", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });

    mockPrisma.taskFile.findUnique = vi.fn().mockResolvedValue(null);

    const res = await app.request("/copy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskFileId: "tf_nonexistent",
        scope: "me",
      }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.message).toContain("TaskFile not found");
  });

  it("returns 409 when destination file already exists", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

    mockPrisma.taskFile.findUnique = vi.fn().mockResolvedValue({
      id: "tf_123",
      name: "existing.pdf",
      fileUrl: "https://example.com/tasks/existing.pdf",
      mimeType: "application/pdf",
      size: BigInt(1024),
      task: {
        id: "tsk_456",
        workspaceId: "ws_personal",
      },
    });

    // head succeeds (file already exists)
    headMock.mockResolvedValue({
      url: "https://example.com/drive/users/user_123/existing.pdf",
    });

    const res = await app.request("/copy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "me",
      }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.message).toContain("already exists");
  });

  it("returns 409 when destination folder with same name exists", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

    mockPrisma.taskFile.findUnique = vi.fn().mockResolvedValue({
      id: "tf_123",
      name: "folder-name.pdf",
      fileUrl: "https://example.com/tasks/folder-name.pdf",
      mimeType: "application/pdf",
      size: BigInt(1024),
      task: {
        id: "tsk_456",
        workspaceId: "ws_personal",
      },
    });

    headMock.mockRejectedValue({ statusCode: 404 });

    // list returns a folder with that prefix
    listMock.mockResolvedValue({
      blobs: [{ pathname: "drive/users/user_123/folder-name.pdf/file.txt" }],
    });

    const res = await app.request("/copy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "me",
      }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.message).toContain(
      "folder with that name already exists",
    );
  });

  it("sanitizes file name on copy", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

    mockPrisma.taskFile.findUnique = vi.fn().mockResolvedValue({
      id: "tf_123",
      name: "bad/../name.pdf",
      fileUrl: "https://example.com/tasks/bad-name.pdf",
      mimeType: "application/pdf",
      size: BigInt(1024),
      task: {
        id: "tsk_456",
        workspaceId: "ws_personal",
      },
    });

    headMock.mockRejectedValue({ statusCode: 404 });
    listMock.mockResolvedValue({ blobs: [] });
    ssrfSafeFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(1024),
    });
    putMock.mockResolvedValue({
      url: "https://example.com/drive/users/user_123/bad_name.pdf",
      pathname: "drive/users/user_123/bad_name.pdf",
    });

    const res = await app.request("/copy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "me",
      }),
    });

    expect(res.status).toBe(201);
    expect(putMock).toHaveBeenCalledWith(
      expect.stringContaining("bad_name.pdf"),
      expect.any(ArrayBuffer),
      expect.any(Object),
    );
  });

  it("uses application/octet-stream when mimeType is null", async () => {
    requireAuthorizedUserContextMock.mockResolvedValue({
      userId: "user_123",
    });
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);
    requireTaskReadForRouteVarsMock.mockResolvedValue(undefined);

    mockPrisma.taskFile.findUnique = vi.fn().mockResolvedValue({
      id: "tf_123",
      name: "unknown.bin",
      fileUrl: "https://example.com/tasks/unknown.bin",
      mimeType: null,
      size: null,
      task: {
        id: "tsk_456",
        workspaceId: "ws_personal",
      },
    });

    headMock.mockRejectedValue({ statusCode: 404 });
    listMock.mockResolvedValue({ blobs: [] });
    ssrfSafeFetchMock.mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(512),
    });
    putMock.mockResolvedValue({
      url: "https://example.com/drive/users/user_123/unknown.bin",
      pathname: "drive/users/user_123/unknown.bin",
    });

    const res = await app.request("/copy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        taskFileId: "tf_123",
        scope: "me",
      }),
    });

    expect(res.status).toBe(201);
    expect(putMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(ArrayBuffer),
      expect.objectContaining({
        contentType: "application/octet-stream",
      }),
    );
  });
});
