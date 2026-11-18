import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

/**
 * Make a copy: a second, independent file beside the first.
 *
 * The copy must never go through rename (copy-then-delete), must leave the
 * source in place, must get its own catalog identity so its tags, links and
 * deletion are its own, and must not buy paid label evaluations.
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

const blob = vi.hoisted(() => ({
  list: vi.fn(),
  head: vi.fn(),
  del: vi.fn(),
  rename: vi.fn(),
  copy: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({ ...blob, BlobNotFoundError }));

const db = vi.hoisted(() => ({
  rooms: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => {
  const client = {
    dataRoom: { findMany: db.rooms },
    fileResource: { findUnique: db.findUnique },
  };
  return {
    default: {
      ...client,
      $transaction: async (fn: (tx: typeof client) => unknown) => fn(client),
    },
  };
});

const { adoptMock, requireAccessMock, nudgeExtraction, nudgeIndexing } =
  vi.hoisted(() => ({
    adoptMock: vi.fn(),
    requireAccessMock: vi.fn(),
    nudgeExtraction: vi.fn(),
    nudgeIndexing: vi.fn(),
  }));

vi.mock("@/services/file-catalog.service", () => ({
  adoptDriveUploadResource: adoptMock,
}));

vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileExtraction: nudgeExtraction,
  nudgeFileIndexing: nudgeIndexing,
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
      BLOB_READ_WRITE_TOKEN: "public-token",
      DATA_ROOM_BLOB_READ_WRITE_TOKEN: "private-token",
      BETTER_AUTH_SECRET: "test-better-auth-secret",
    }),
  };
});

import { forgetDriveRooms } from "@/lib/drive-blob";
import mountCopy from "./copy.js";

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

function copyRequest(body: Record<string, unknown>) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("authContext", USER_AUTH_CONTEXT);
    await next();
  });
  mountCopy(app);
  return app.request("/copy", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FOLDER = "drive/users/user_123/briefs/";
const SOURCE = `${FOLDER}weekly.md`;
const SOURCE_META = {
  pathname: SOURCE,
  contentType: "text/markdown",
  cacheControl: "public, max-age=60",
  size: 42,
  uploadedAt: new Date("2026-11-01T00:00:00Z"),
};

/** Blobs that exist, by pathname, and which store holds each. */
let stored: Map<string, "public-token" | "private-token">;

beforeEach(() => {
  vi.clearAllMocks();
  forgetDriveRooms();
  stored = new Map([[SOURCE, "public-token"]]);
  db.rooms.mockResolvedValue([]);
  db.findUnique.mockResolvedValue(null);
  requireAccessMock.mockResolvedValue({ hiddenRoomFolders: [] });
  blob.list.mockResolvedValue({ blobs: [], hasMore: false });
  blob.del.mockResolvedValue(undefined);
  adoptMock.mockResolvedValue("resource-copy");
  blob.head.mockImplementation(
    async (pathname: string, { token }: { token: string }) => {
      if (stored.get(pathname) === token) return { ...SOURCE_META, pathname };
      throw new BlobNotFoundError("gone");
    },
  );
  blob.copy.mockImplementation(async (_from: string, to: string) => ({
    url: `https://store.public.blob.vercel-storage.com/${to}`,
    pathname: to,
  }));
  blob.get.mockResolvedValue({ statusCode: 200, stream: "bytes", blob: {} });
  blob.put.mockImplementation(async (to: string) => ({
    url: `https://store.private.blob.vercel-storage.com/${to}`,
    pathname: to,
  }));
});

describe("copy a Drive file", () => {
  it("copies into the same folder, keeps the source, and catalogs the copy", async () => {
    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    const target = `${FOLDER}weekly (copy).md`;
    expect(blob.copy).toHaveBeenCalledWith(
      SOURCE,
      target,
      expect.objectContaining({
        token: "public-token",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "text/markdown",
      }),
    );
    expect(blob.rename).not.toHaveBeenCalled();
    expect(blob.del).not.toHaveBeenCalled();
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
        client: expect.anything(),
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

  it("starts free extraction only, never paid label evaluation", async () => {
    await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(nudgeExtraction).toHaveBeenCalledTimes(1);
    expect(nudgeIndexing).not.toHaveBeenCalled();
  });

  it("numbers the copy when that name is taken by a file", async () => {
    stored.set(`${FOLDER}weekly (copy).md`, "public-token");

    await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(blob.copy).toHaveBeenCalledWith(
      SOURCE,
      `${FOLDER}weekly (copy) 2.md`,
      expect.anything(),
    );
  });

  it("numbers the copy when the catalog still holds that name", async () => {
    db.findUnique.mockImplementation(
      async ({ where }: { where: Record<string, { sourceId: string }> }) =>
        Object.values(where)[0].sourceId === `${FOLDER}weekly (copy).md`
          ? { id: "old-document" }
          : null,
    );

    await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(blob.copy).toHaveBeenCalledWith(
      SOURCE,
      `${FOLDER}weekly (copy) 2.md`,
      expect.anything(),
    );
  });

  it("returns 404 when the source is gone", async () => {
    const response = await copyRequest({
      pathname: `${FOLDER}missing.md`,
      label: "copy",
    });

    expect(response.status).toBe(404);
    expect(blob.copy).not.toHaveBeenCalled();
    expect(adoptMock).not.toHaveBeenCalled();
  });

  it("writes nothing when access is denied", async () => {
    const { forbidden } = await import("@/helpers/error");
    requireAccessMock.mockRejectedValue(forbidden("not yours"));

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(403);
    expect(blob.copy).not.toHaveBeenCalled();
    expect(blob.put).not.toHaveBeenCalled();
    expect(adoptMock).not.toHaveBeenCalled();
  });
});

describe("names", () => {
  it("refuses a label with a slash, so a copy cannot leave its folder", async () => {
    const response = await copyRequest({ pathname: SOURCE, label: "../x" });

    expect(response.status).toBe(422);
    expect(blob.copy).not.toHaveBeenCalled();
  });

  it("refuses to copy a folder marker", async () => {
    const marker = `${FOLDER}__drive_folder__`;
    stored.set(marker, "public-token");

    const response = await copyRequest({ pathname: marker, label: "copy" });

    expect(response.status).toBe(422);
    expect(blob.copy).not.toHaveBeenCalled();
  });

  it("trims a long name's stem to keep the label, number and extension", async () => {
    const stem = "a".repeat(252);
    const source = `${FOLDER}${stem}.md`;
    stored.set(source, "public-token");
    stored.set(`${FOLDER}${"a".repeat(245)} (copy).md`, "public-token");

    const response = await copyRequest({ pathname: source, label: "copy" });

    expect(response.status).toBe(200);
    const name = `${"a".repeat(243)} (copy) 2.md`;
    expect(name).toHaveLength(255);
    expect(blob.copy).toHaveBeenCalledWith(
      source,
      `${FOLDER}${name}`,
      expect.anything(),
    );
  });

  it("gives each numbered try of a 255-character name its own name", async () => {
    const source = `${FOLDER}${"b".repeat(255)}`;
    stored.set(source, "public-token");
    const first = `${"b".repeat(248)} (copy)`;
    stored.set(`${FOLDER}${first}`, "public-token");

    await copyRequest({ pathname: source, label: "copy" });

    const target = `${FOLDER}${"b".repeat(246)} (copy) 2`;
    expect(target.length - FOLDER.length).toBe(255);
    expect(blob.copy).toHaveBeenCalledWith(source, target, expect.anything());
  });
});

describe("a failed catalog write", () => {
  it("removes the copied bytes, so a retry gets the same name", async () => {
    adoptMock.mockRejectedValueOnce(new Error("database down"));

    const failed = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(failed.status).toBe(500);
    const target = `${FOLDER}weekly (copy).md`;
    expect(blob.del).toHaveBeenCalledWith(target, { token: "public-token" });

    const retried = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(retried.status).toBe(200);
    expect(blob.copy).toHaveBeenLastCalledWith(
      SOURCE,
      target,
      expect.anything(),
    );
  });

  it("returns 409 and removes the bytes when another request took the name", async () => {
    adoptMock.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(409);
    expect(blob.del).toHaveBeenCalledWith(`${FOLDER}weekly (copy).md`, {
      token: "public-token",
    });
  });
});

describe("a data room moving between stores", () => {
  it("reads a source still in the public store while the room moves in", async () => {
    db.rooms.mockResolvedValue([
      { folderPath: "briefs", storage: "MOVING_IN" },
    ]);

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    expect(blob.get).toHaveBeenCalledWith(SOURCE, {
      access: "public",
      token: "public-token",
    });
    expect(blob.put).toHaveBeenCalledWith(
      `${FOLDER}weekly (copy).md`,
      "bytes",
      expect.objectContaining({
        access: "private",
        token: "private-token",
        allowOverwrite: false,
      }),
    );
    expect(blob.del).not.toHaveBeenCalled();
    const json = await response.json();
    expect(json.data.dataRoom).toBe(true);
  });

  it("reads a source still in the private store while the room moves out", async () => {
    stored.set(SOURCE, "private-token");
    db.rooms.mockResolvedValue([
      { folderPath: "briefs", storage: "MOVING_OUT" },
    ]);

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    expect(blob.get).toHaveBeenCalledWith(SOURCE, {
      access: "private",
      token: "private-token",
    });
    expect(blob.put).toHaveBeenCalledWith(
      `${FOLDER}weekly (copy).md`,
      "bytes",
      expect.objectContaining({ access: "public", token: "public-token" }),
    );
    expect(blob.del).not.toHaveBeenCalled();
  });
});
