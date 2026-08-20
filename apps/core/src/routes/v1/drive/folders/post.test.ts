import { beforeEach, describe, expect, it, vi } from "vitest";

import mountPost from "./post";

// Mock @vercel/blob
vi.mock("@vercel/blob", () => ({
  head: vi.fn(),
  list: vi.fn(),
  put: vi.fn(),
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));

// Mock user context
vi.mock("@/middleware/auth", () => ({
  requireUserContext: vi.fn(),
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

import { head, list, put } from "@vercel/blob";
import { requireUserDriveFileUploadAccess } from "@/helpers/drive-file-access";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";

const headMock = vi.mocked(head);
const listMock = vi.mocked(list);
const putMock = vi.mocked(put);
const requireUserContextMock = vi.mocked(requireUserContext);
const requireUserDriveFileUploadAccessMock = vi.mocked(
  requireUserDriveFileUploadAccess,
);

describe("POST /v1/drive/folders (create folder)", () => {
  let app: OpenAPIHonoWithAuth;

  beforeEach(() => {
    vi.clearAllMocks();
    app = new OpenAPIHonoWithAuth();
    mountPost(app);
  });

  it("rejects 'Tasks' as root folder name (reserved)", async () => {
    requireUserContextMock.mockReturnValue({
      userId: "user_123",
    });
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    const res = await app.request("/", {
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
    expect(json.error.message).toContain("reserved");
    expect(json.error.message).toContain("Tasks");
  });

  it("rejects 'Tasks' nested in path (root segment check)", async () => {
    requireUserContextMock.mockReturnValue({
      userId: "user_123",
    });
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    const res = await app.request("/", {
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
    expect(json.error.message).toContain("reserved");
  });

  it("allows 'Tasks' as non-root segment", async () => {
    requireUserContextMock.mockReturnValue({
      userId: "user_123",
    });
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    listMock.mockResolvedValue({ blobs: [] });
    headMock.mockRejectedValue({ statusCode: 404 });
    putMock.mockResolvedValue({
      url: "https://example.com/drive/users/user_123/Projects/Tasks/__drive_folder__",
      pathname: "drive/users/user_123/Projects/Tasks/__drive_folder__",
    });

    const res = await app.request("/", {
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
    requireUserContextMock.mockReturnValue({
      userId: "user_123",
    });
    requireUserDriveFileUploadAccessMock.mockResolvedValue(undefined);

    listMock.mockResolvedValue({ blobs: [] });
    headMock.mockRejectedValue({ statusCode: 404 });
    putMock.mockResolvedValue({
      url: "https://example.com/drive/users/user_123/Documents/__drive_folder__",
      pathname: "drive/users/user_123/Documents/__drive_folder__",
    });

    const res = await app.request("/", {
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
