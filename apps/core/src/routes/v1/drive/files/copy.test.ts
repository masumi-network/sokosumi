import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

/**
 * Make a copy: a second, independent file beside one of your own.
 *
 * Personal files only. Each request reserves a fresh catalog row, writes
 * exclusively, and activates only that row with the metadata of the bytes it
 * wrote. It never joins another request's row and never buys a paid label.
 *
 * The catalog and Blob store are modelled with state, so races and failures
 * are checked against what each step left behind.
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

const rooms = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db/prisma", () => ({
  default: { dataRoom: { findMany: rooms } },
}));

const catalog = vi.hoisted(() => ({
  reserve: vi.fn(),
  release: vi.fn(),
  activate: vi.fn(),
}));

vi.mock("@/services/file-catalog.service", () => ({
  reserveDriveCopyResource: catalog.reserve,
  releaseDriveCopyResource: catalog.release,
  activateDriveCopyResource: catalog.activate,
}));

const { requireAccessMock, nudgeExtraction, nudgeIndexing } = vi.hoisted(
  () => ({
    requireAccessMock: vi.fn(),
    nudgeExtraction: vi.fn(),
    nudgeIndexing: vi.fn(),
  }),
);

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
import mountCopy, { copyName } from "./copy.js";

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
const TARGET = `${FOLDER}weekly (copy).md`;

type Token = "public-token" | "private-token";
interface StoredObject {
  token: Token;
  etag: string;
  size: number;
}
/** Objects that exist, by pathname. */
let stored: Map<string, StoredObject>;
/** Catalog rows by pathname. A copy's row starts pending at revision 1. */
let rows: Map<string, { id: string; active: boolean; revision: number }>;
/** Order of side effects, to check identity comes before bytes. */
let events: string[];
let etags: number;

function rowById(id: string) {
  return [...rows.values()].find((row) => row.id === id);
}

beforeEach(() => {
  vi.clearAllMocks();
  forgetDriveRooms();
  etags = 0;
  stored = new Map([[SOURCE, { token: "public-token", etag: "e0", size: 42 }]]);
  rows = new Map();
  events = [];
  rooms.mockResolvedValue([]);
  requireAccessMock.mockResolvedValue({ hiddenRoomFolders: [] });
  blob.list.mockResolvedValue({ blobs: [], hasMore: false });
  blob.head.mockImplementation(
    async (pathname: string, { token }: { token: string }) => {
      const object = stored.get(pathname);
      if (object?.token === token)
        return {
          contentType: "text/markdown",
          cacheControl: "public, max-age=60",
          size: object.size,
          etag: object.etag,
          uploadedAt: new Date("2026-11-01T00:00:00Z"),
          pathname,
          url: `https://blob.example/${pathname}`,
        };
      throw new BlobNotFoundError("gone");
    },
  );
  blob.copy.mockImplementation(
    async (from: string, to: string, { token }: { token: Token }) => {
      const source = stored.get(from);
      if (!source) throw new BlobNotFoundError("gone");
      if (stored.has(to)) throw new Error("This blob already exists");
      const etag = `e${++etags}`;
      stored.set(to, { token, etag, size: source.size });
      events.push(`bytes:${to}`);
      return { url: `https://blob.example/${to}`, pathname: to, etag };
    },
  );
  catalog.reserve.mockImplementation(async ({ key }) => {
    if (rows.has(key.pathname))
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    const id = `res-${rows.size + 1}`;
    rows.set(key.pathname, { id, active: false, revision: 1 });
    events.push(`reserve:${key.pathname}`);
    return id;
  });
  catalog.release.mockImplementation(async (id: string) => {
    for (const [pathname, row] of rows)
      if (row.id === id && !row.active && row.revision === 1)
        rows.delete(pathname);
  });
  catalog.activate.mockImplementation(async ({ resourceId }) => {
    const row = rowById(resourceId);
    if (!row || row.revision !== 1) return false;
    row.active = true;
    events.push(`activate:${resourceId}`);
    return true;
  });
});

describe("copy a personal file", () => {
  it("reserves identity, then copies, then activates, and keeps the source", async () => {
    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    expect(events).toEqual([
      `reserve:${TARGET}`,
      `bytes:${TARGET}`,
      "activate:res-1",
    ]);
    expect(catalog.reserve).toHaveBeenCalledWith({
      key: {
        workspaceId: "workspace-1",
        scope: "user",
        ownerId: "user_123",
        pathname: TARGET,
      },
      displayName: "weekly (copy).md",
      mimeType: "text/markdown",
      sizeBytes: 42,
      decidedByUserId: "user_123",
    });
    expect(blob.copy).toHaveBeenCalledWith(
      SOURCE,
      TARGET,
      expect.objectContaining({
        token: "public-token",
        addRandomSuffix: false,
        allowOverwrite: false,
      }),
    );
    expect(stored.has(SOURCE)).toBe(true);
    expect(blob.rename).not.toHaveBeenCalled();
    expect(blob.del).not.toHaveBeenCalled();
    expect(requireAccessMock).toHaveBeenCalledWith(
      USER_AUTH_CONTEXT,
      "user",
      "user_123",
      { changes: ["briefs/weekly.md"], into: ["briefs"] },
    );
    const json = await response.json();
    expect(json.data).toMatchObject({
      name: "weekly (copy).md",
      pathname: TARGET,
      resourceId: "res-1",
      dataRoom: false,
    });
  });

  it("starts free extraction only, never paid label evaluation", async () => {
    await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(nudgeExtraction).toHaveBeenCalledTimes(1);
    expect(nudgeIndexing).not.toHaveBeenCalled();
  });

  it("numbers the copy when a file holds that name", async () => {
    stored.set(TARGET, { token: "public-token", etag: "x", size: 1 });

    await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(blob.copy).toHaveBeenCalledWith(
      SOURCE,
      `${FOLDER}weekly (copy) 2.md`,
      expect.anything(),
    );
  });

  it("never joins another request's unfinished copy; it takes the next name", async () => {
    rows.set(TARGET, { id: "someone-else", active: false, revision: 1 });

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    expect((await response.json()).data.resourceId).toBe("res-2");
    expect(rows.get(TARGET)).toEqual({
      id: "someone-else",
      active: false,
      revision: 1,
    });
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
    expect(catalog.reserve).not.toHaveBeenCalled();
    expect(blob.copy).not.toHaveBeenCalled();
  });
});

describe("only your own personal files", () => {
  it.each([
    ["an organization file", "drive/organizations/org_1/briefs/weekly.md", 403],
    ["another user's file", "drive/users/user_999/briefs/weekly.md", 422],
  ])("refuses %s and writes nothing", async (_case, pathname, status) => {
    stored.set(pathname, { token: "public-token", etag: "o", size: 1 });

    const response = await copyRequest({ pathname, label: "copy" });

    expect(response.status).toBe(status);
    expect(catalog.reserve).not.toHaveBeenCalled();
    expect(blob.copy).not.toHaveBeenCalled();
  });

  it("refuses a file in a data room", async () => {
    rooms.mockResolvedValue([{ folderPath: "briefs", storage: "PRIVATE" }]);
    stored.set(SOURCE, { token: "private-token", etag: "p", size: 42 });

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(403);
    expect(catalog.reserve).not.toHaveBeenCalled();
    expect(blob.copy).not.toHaveBeenCalled();
  });

  it("writes nothing when access is denied", async () => {
    const { forbidden } = await import("@/helpers/error");
    requireAccessMock.mockRejectedValue(forbidden("not yours"));

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(403);
    expect(catalog.reserve).not.toHaveBeenCalled();
    expect(blob.copy).not.toHaveBeenCalled();
    expect(catalog.activate).not.toHaveBeenCalled();
  });
});

describe("races and failures never activate the wrong bytes", () => {
  it("activates with the bytes written, not the source as first seen", async () => {
    blob.copy.mockImplementationOnce(async (_from: string, to: string) => {
      // The source was replaced between its head and the copy.
      stored.set(to, { token: "public-token", etag: "new", size: 7 });
      return { url: `https://blob.example/${to}`, pathname: to, etag: "new" };
    });

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    expect(catalog.activate).toHaveBeenCalledWith({
      resourceId: "res-1",
      sizeBytes: 7,
      mimeType: "text/markdown",
    });
    expect((await response.json()).data.size).toBe(7);
  });

  it("refuses to activate when another writer replaced the bytes", async () => {
    blob.copy.mockImplementationOnce(async (_from: string, to: string) => {
      stored.set(to, { token: "public-token", etag: "upload", size: 9 });
      return { url: `https://blob.example/${to}`, pathname: to, etag: "mine" };
    });

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(409);
    expect(catalog.activate).not.toHaveBeenCalled();
    expect(rows.get(TARGET)?.active).toBe(false);
  });

  it("refuses to activate a row an upload versioned in the meantime", async () => {
    blob.copy.mockImplementationOnce(async (_from: string, to: string) => {
      const row = rows.get(to);
      if (row) row.revision = 2;
      stored.set(to, { token: "public-token", etag: "c", size: 42 });
      return { url: `https://blob.example/${to}`, pathname: to, etag: "c" };
    });

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(409);
    expect(rows.get(TARGET)).toMatchObject({ active: false, revision: 2 });
  });

  it("releases the reservation when no bytes landed, and a retry starts fresh", async () => {
    blob.copy.mockRejectedValueOnce(new Error("Blob service unavailable"));

    const failed = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(failed.status).toBe(500);
    expect(catalog.release).toHaveBeenCalledWith("res-1");
    expect(rows.has(TARGET)).toBe(false);

    const retried = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(retried.status).toBe(200);
    expect((await retried.json()).data.pathname).toBe(TARGET);
  });

  it("keeps a failed copy's row pending over bytes it cannot prove are its own", async () => {
    blob.copy.mockImplementationOnce(async (_from: string, to: string) => {
      stored.set(to, { token: "public-token", etag: "?", size: 1 });
      throw new Error("Blob service unavailable");
    });

    const failed = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(failed.status).toBe(500);
    expect(catalog.release).not.toHaveBeenCalled();
    expect(catalog.activate).not.toHaveBeenCalled();
    expect(rows.get(TARGET)?.active).toBe(false);

    const retried = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect((await retried.json()).data.pathname).toBe(
      `${FOLDER}weekly (copy) 2.md`,
    );
  });

  it("returns 404 and releases when the source vanished before the copy", async () => {
    blob.copy.mockRejectedValueOnce(new BlobNotFoundError("gone"));

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(404);
    expect(rows.has(TARGET)).toBe(false);
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
    stored.set(marker, { token: "public-token", etag: "m", size: 0 });

    const response = await copyRequest({ pathname: marker, label: "copy" });

    expect(response.status).toBe(422);
    expect(catalog.reserve).not.toHaveBeenCalled();
  });

  it("trims a long name's stem to keep the label, number and extension", async () => {
    const source = `${FOLDER}${"a".repeat(252)}.md`;
    stored.set(source, { token: "public-token", etag: "l", size: 3 });
    stored.set(`${FOLDER}${"a".repeat(245)} (copy).md`, {
      token: "public-token",
      etag: "t",
      size: 3,
    });

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

  it("gives each numbered try of a 255-character name its own name", () => {
    const source = "b".repeat(255);
    const first = copyName(source, "copy", 1);
    const second = copyName(source, "copy", 2);

    expect(first).toBe(`${"b".repeat(248)} (copy)`);
    expect(second).toBe(`${"b".repeat(246)} (copy) 2`);
    expect(first).toHaveLength(255);
    expect(second).toHaveLength(255);
  });

  it("never splits an emoji at the trim boundary", () => {
    // 247 letters then an emoji (two UTF-16 units): one unit over the room.
    const source = `${"c".repeat(247)}😀.md`;

    const name = copyName(source, "copy", 1);

    expect(name).toBe(`${"c".repeat(245)} (copy).md`);
    expect(name.isWellFormed()).toBe(true);
    expect(name.length).toBeLessThanOrEqual(255);
  });

  it("keeps a whole emoji when it fits", () => {
    const name = copyName(`${"c".repeat(240)}😀.md`, "copy", 1);

    expect(name).toBe(`${"c".repeat(240)}😀 (copy).md`);
    expect(name.isWellFormed()).toBe(true);
  });
});
