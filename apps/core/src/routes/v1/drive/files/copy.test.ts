import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

/**
 * Make a copy: a second, independent file beside the first.
 *
 * The copy must never go through rename (copy-then-delete), must leave the
 * source in place, and must get its own catalog identity so its tags, links
 * and deletion are its own.
 */

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { BlobNotFoundError } = vi.hoisted(() => ({
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));

const { listMock, headMock, delMock, renameMock, copyMock } = vi.hoisted(
  () => ({
    listMock: vi.fn(),
    headMock: vi.fn(),
    delMock: vi.fn(),
    renameMock: vi.fn(),
    copyMock: vi.fn(),
  }),
);

vi.mock("@vercel/blob", () => ({
  list: listMock,
  head: headMock,
  del: delMock,
  rename: renameMock,
  copy: copyMock,
  BlobNotFoundError,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { dataRoom: { findMany: vi.fn(async () => []) } },
}));

const { adoptMock, requireAccessMock } = vi.hoisted(() => ({
  adoptMock: vi.fn(),
  requireAccessMock: vi.fn(),
}));

vi.mock("@/services/file-catalog.service", () => ({
  adoptDriveUploadResource: adoptMock,
}));

vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileIndexing: vi.fn(),
}));

vi.mock("@/helpers/drive-file-access", () => ({
  drivePathOf: (pathname: string) => pathname.split("/").slice(3).join("/"),
  requireDriveFileAccess: requireAccessMock,
}));

vi.mock("@/helpers/drive-tasks-workspace", () => ({
  resolveDriveTasksWorkspace: vi
    .fn()
    .mockResolvedValue({ workspaceId: "workspace-1" }),
}));

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({
      ...actual.getEnv(),
      BLOB_READ_WRITE_TOKEN: "test-token",
      BETTER_AUTH_SECRET: "test-better-auth-secret",
    }),
  };
});

import mountCopy from "./copy.js";

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

function app() {
  const hono = new OpenAPIHonoWithAuth();
  hono.onError(errorHandler);
  hono.use("*", async (c, next) => {
    c.set("authContext", USER_AUTH_CONTEXT);
    await next();
  });
  mountCopy(hono);
  return hono;
}

function copyRequest(body: Record<string, unknown>) {
  return app().request("/copy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SOURCE = "drive/users/user_123/briefs/weekly.md";
const SOURCE_META = {
  contentType: "text/markdown",
  cacheControl: "public, max-age=60",
  size: 42,
  uploadedAt: new Date("2026-11-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAccessMock.mockResolvedValue({ hiddenRoomFolders: [] });
  listMock.mockResolvedValue({ blobs: [], hasMore: false });
  adoptMock.mockResolvedValue("resource-copy");
  copyMock.mockImplementation(async (_from: string, to: string) => ({
    url: `https://store.public.blob.vercel-storage.com/${to}`,
    pathname: to,
  }));
  // Source exists; every other pathname is free.
  headMock.mockImplementation(async (pathname: string) => {
    if (pathname === SOURCE) return SOURCE_META;
    throw new BlobNotFoundError("gone");
  });
});

describe("copy a Drive file", () => {
  it("copies into the same folder, keeps the source, and catalogs the copy", async () => {
    const response = await copyRequest({
      pathname: SOURCE,
      filename: "weekly (copy).md",
    });

    expect(response.status).toBe(200);
    const target = "drive/users/user_123/briefs/weekly (copy).md";
    expect(copyMock).toHaveBeenCalledWith(
      SOURCE,
      target,
      expect.objectContaining({
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "text/markdown",
      }),
    );
    expect(renameMock).not.toHaveBeenCalled();
    expect(delMock).not.toHaveBeenCalled();
    expect(adoptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: {
          workspaceId: "workspace-1",
          scope: "user",
          ownerId: "user_123",
          pathname: target,
        },
        displayName: "weekly (copy).md",
        sizeBytes: 42,
      }),
    );
    expect(requireAccessMock).toHaveBeenCalledWith(
      USER_AUTH_CONTEXT,
      "user",
      "user_123",
      { changes: ["briefs/weekly.md"], into: ["briefs"] },
    );
    const json = await response.json();
    expect(json.data).toMatchObject({
      name: "weekly (copy).md",
      pathname: target,
      resourceId: "resource-copy",
    });
  });

  it("numbers the copy when that name is taken", async () => {
    headMock.mockImplementation(async (pathname: string) => {
      if (pathname === SOURCE) return SOURCE_META;
      if (pathname === "drive/users/user_123/briefs/weekly (copy).md")
        return SOURCE_META;
      throw new BlobNotFoundError("gone");
    });

    const response = await copyRequest({
      pathname: SOURCE,
      filename: "weekly (copy).md",
    });

    expect(response.status).toBe(200);
    expect(copyMock).toHaveBeenCalledWith(
      SOURCE,
      "drive/users/user_123/briefs/weekly (copy) 2.md",
      expect.anything(),
    );
  });

  it("returns 404 when the source is gone", async () => {
    const response = await copyRequest({
      pathname: "drive/users/user_123/missing.md",
      filename: "missing (copy).md",
    });

    expect(response.status).toBe(404);
    expect(copyMock).not.toHaveBeenCalled();
    expect(adoptMock).not.toHaveBeenCalled();
  });

  it("refuses a name with a slash, so a copy cannot leave its folder", async () => {
    const response = await copyRequest({
      pathname: SOURCE,
      filename: "../elsewhere.md",
    });

    expect(response.status).toBe(422);
    expect(copyMock).not.toHaveBeenCalled();
  });
});
