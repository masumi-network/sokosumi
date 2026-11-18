import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

/**
 * Make a copy: a second, independent file beside the first.
 *
 * The copy never goes through rename (copy-then-delete) and leaves the source
 * in place. Its catalog identity is reserved before its bytes exist, so a
 * backfill or a retry finds the owner, and nothing ever deletes bytes. It
 * never buys a paid label evaluation.
 *
 * The catalog and Blob store are modelled with state, so a failure followed
 * by a retry is checked against what the first request left behind.
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
  holder: vi.fn(),
  activate: vi.fn(),
  adopt: vi.fn(),
}));

vi.mock("@/services/file-catalog.service", () => ({
  reserveDriveCopyResource: catalog.reserve,
  driveCopyHolder: catalog.holder,
  activateDriveUploadResource: catalog.activate,
  adoptDriveUploadResource: catalog.adopt,
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
const SOURCE_META = {
  contentType: "text/markdown",
  cacheControl: "public, max-age=60",
  size: 42,
  uploadedAt: new Date("2026-11-01T00:00:00Z"),
};

type Token = "public-token" | "private-token";
/** Objects that exist, by pathname, and the store each is in. */
let stored: Map<string, Token>;
/** Catalog rows by pathname. `copy` marks a reserved copy's pins. */
let rows: Map<string, { id: string; active: boolean; copy: boolean }>;
/** Order of side effects, to check identity comes before bytes. */
let events: string[];

beforeEach(() => {
  vi.clearAllMocks();
  forgetDriveRooms();
  stored = new Map([[SOURCE, "public-token"]]);
  rows = new Map();
  events = [];
  rooms.mockResolvedValue([]);
  requireAccessMock.mockResolvedValue({ hiddenRoomFolders: [] });
  blob.list.mockResolvedValue({ blobs: [], hasMore: false });
  blob.head.mockImplementation(
    async (pathname: string, { token }: { token: string }) => {
      if (stored.get(pathname) === token)
        return {
          ...SOURCE_META,
          pathname,
          url: `https://blob.example/${pathname}`,
        };
      throw new BlobNotFoundError("gone");
    },
  );
  blob.copy.mockImplementation(
    async (_from: string, to: string, { token }: { token: Token }) => {
      if (stored.has(to)) throw new Error("This blob already exists");
      stored.set(to, token);
      events.push(`bytes:${to}`);
      return { url: `https://blob.example/${to}`, pathname: to };
    },
  );
  blob.get.mockResolvedValue({ statusCode: 200, stream: "bytes", blob: {} });
  blob.put.mockImplementation(
    async (to: string, _body: unknown, { token }: { token: Token }) => {
      stored.set(to, token);
      events.push(`bytes:${to}`);
      return { url: `https://blob.example/${to}`, pathname: to };
    },
  );
  catalog.holder.mockImplementation(async ({ pathname }) => {
    const row = rows.get(pathname);
    if (!row) return "free";
    return !row.active && row.copy ? "unfinished-copy" : "taken";
  });
  catalog.reserve.mockImplementation(async ({ key }) => {
    if (rows.has(key.pathname))
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    rows.set(key.pathname, {
      id: `res-${rows.size + 1}`,
      active: false,
      copy: true,
    });
    events.push(`reserve:${key.pathname}`);
    return rows.get(key.pathname)?.id;
  });
  catalog.activate.mockImplementation(async ({ key }) => {
    const row = rows.get(key.pathname);
    if (!row) return null;
    row.active = true;
    events.push(`activate:${key.pathname}`);
    return { resourceId: row.id };
  });
});

describe("copy a Drive file", () => {
  it("reserves identity, then copies, then activates, and keeps the source", async () => {
    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    expect(events).toEqual([
      `reserve:${TARGET}`,
      `bytes:${TARGET}`,
      `activate:${TARGET}`,
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
    expect(catalog.adopt).not.toHaveBeenCalled();
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
    stored.set(TARGET, "public-token");

    await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(blob.copy).toHaveBeenCalledWith(
      SOURCE,
      `${FOLDER}weekly (copy) 2.md`,
      expect.anything(),
    );
  });

  it("numbers the copy when another document holds that name in the catalog", async () => {
    rows.set(TARGET, { id: "someone-else", active: true, copy: false });

    await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(blob.copy).toHaveBeenCalledWith(
      SOURCE,
      `${FOLDER}weekly (copy) 2.md`,
      expect.anything(),
    );
  });

  it("takes the next name when another request reserves this one first", async () => {
    catalog.reserve.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint"), { code: "P2002" }),
    );

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
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

  it("writes nothing when access is denied", async () => {
    const { forbidden } = await import("@/helpers/error");
    requireAccessMock.mockRejectedValue(forbidden("not yours"));

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(403);
    expect(catalog.reserve).not.toHaveBeenCalled();
    expect(blob.copy).not.toHaveBeenCalled();
    expect(blob.put).not.toHaveBeenCalled();
    expect(catalog.activate).not.toHaveBeenCalled();
  });
});

describe("failures leave an unfinished copy that a retry finishes", () => {
  it("finishes the same copy when activation failed after the bytes landed", async () => {
    catalog.activate.mockRejectedValueOnce(new Error("database down"));

    const failed = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(failed.status).toBe(500);
    expect(stored.has(TARGET)).toBe(true);
    expect(blob.del).not.toHaveBeenCalled();

    const retried = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(retried.status).toBe(200);
    expect(blob.copy).toHaveBeenCalledTimes(1);
    expect(catalog.reserve).toHaveBeenCalledTimes(1);
    expect(rows.get(TARGET)).toEqual({ id: "res-1", active: true, copy: true });
    expect((await retried.json()).data.pathname).toBe(TARGET);
    expect([...stored.keys()].filter((key) => key !== SOURCE)).toEqual([
      TARGET,
    ]);
  });

  it("finishes the same copy when the byte copy failed after the reservation", async () => {
    blob.copy.mockRejectedValueOnce(new Error("Blob service unavailable"));

    const failed = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(failed.status).toBe(500);
    expect(rows.get(TARGET)?.active).toBe(false);

    const retried = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(retried.status).toBe(200);
    expect(catalog.reserve).toHaveBeenCalledTimes(1);
    expect(stored.has(TARGET)).toBe(true);
    expect(rows.get(TARGET)?.active).toBe(true);
  });

  it("keeps the identity when a backfill adopts the bytes before activation", async () => {
    blob.copy.mockImplementationOnce(async (_from: string, to: string) => {
      stored.set(to, "public-token");
      // The backfill sees the object and activates the reserved row.
      const row = rows.get(to);
      if (row) row.active = true;
      return { url: `https://blob.example/${to}`, pathname: to };
    });

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    expect((await response.json()).data.resourceId).toBe("res-1");
    expect(stored.has(TARGET)).toBe(true);
    expect(blob.del).not.toHaveBeenCalled();
    expect(catalog.adopt).not.toHaveBeenCalled();
  });

  it("uses the bytes a concurrent try wrote first", async () => {
    rows.set(TARGET, { id: "res-9", active: false, copy: true });
    blob.copy.mockImplementationOnce(async (_from: string, to: string) => {
      stored.set(to, "public-token");
      throw new Error("This blob already exists");
    });

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    expect((await response.json()).data.resourceId).toBe("res-9");
  });

  it("returns 409 when the copy was deleted before it was finished", async () => {
    catalog.activate.mockResolvedValueOnce(null);

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(409);
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
    expect(catalog.reserve).not.toHaveBeenCalled();
  });

  it("trims a long name's stem to keep the label, number and extension", async () => {
    const source = `${FOLDER}${"a".repeat(252)}.md`;
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

describe("a data room moving between stores", () => {
  it("reads a source still in the public store while the room moves in", async () => {
    rooms.mockResolvedValue([{ folderPath: "briefs", storage: "MOVING_IN" }]);

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    expect(blob.get).toHaveBeenCalledWith(SOURCE, {
      access: "public",
      token: "public-token",
    });
    expect(blob.put).toHaveBeenCalledWith(
      TARGET,
      "bytes",
      expect.objectContaining({
        access: "private",
        token: "private-token",
        allowOverwrite: false,
      }),
    );
    expect(blob.del).not.toHaveBeenCalled();
    expect((await response.json()).data.dataRoom).toBe(true);
  });

  it("reads a source still in the private store while the room moves out", async () => {
    stored.set(SOURCE, "private-token");
    rooms.mockResolvedValue([{ folderPath: "briefs", storage: "MOVING_OUT" }]);

    const response = await copyRequest({ pathname: SOURCE, label: "copy" });

    expect(response.status).toBe(200);
    expect(blob.get).toHaveBeenCalledWith(SOURCE, {
      access: "private",
      token: "private-token",
    });
    expect(blob.put).toHaveBeenCalledWith(
      TARGET,
      "bytes",
      expect.objectContaining({ access: "public", token: "public-token" }),
    );
    expect(blob.del).not.toHaveBeenCalled();
  });
});
