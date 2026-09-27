import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

/**
 * Every route that mutates a Drive object must tell the catalog.
 *
 * Only single-file delete did. Folder delete, file move and folder rename
 * mutated blobs and said nothing, so a deleted document stayed fully indexed
 * — still matching full-text search, still returning content snippets — and
 * a relocated one kept its entry on the vacated pathname, where a later
 * upload inherited its manual tags. That is the case
 * `tombstoneDriveUploadResource`'s own comment says must be impossible.
 *
 * One test per route, because the single-file coverage does not generalise:
 * each route reaches the catalog by a different path, and three of them did
 * not reach it at all.
 */

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { listMock, headMock, delMock, renameMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  headMock: vi.fn(),
  delMock: vi.fn(),
  renameMock: vi.fn(),
}));

// Hoisted with the mocks: `vi.mock` factories run before module scope, so
// the class has to exist by then.
const { BlobNotFoundError } = vi.hoisted(() => ({
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));

vi.mock("@vercel/blob", () => ({
  list: listMock,
  head: headMock,
  del: delMock,
  rename: renameMock,
  BlobNotFoundError,
}));

const { tombstoneManyMock, reconcileMovesMock, tombstoneOneMock } = vi.hoisted(
  () => ({
    tombstoneManyMock: vi.fn(),
    reconcileMovesMock: vi.fn(),
    tombstoneOneMock: vi.fn(),
  }),
);

vi.mock("@/services/file-catalog.service", () => ({
  tombstoneDriveUploadResources: tombstoneManyMock,
  tombstoneDriveUploadResource: tombstoneOneMock,
  reconcileDriveUploadMoves: reconcileMovesMock,
}));

vi.mock("@/helpers/drive-file-access", () => ({
  requireDriveFileAccess: vi.fn().mockResolvedValue(undefined),
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

import mountMove from "./files/move.js";
import mountFolderDelete from "./folders/delete.js";
import mountFolderRename from "./folders/rename.js";

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

function appWith(mount: (app: OpenAPIHonoWithAuth) => void) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("authContext", USER_AUTH_CONTEXT);
    await next();
  });
  mount(app);
  return app;
}

const PREFIX = "drive/users/user_123/reports/";

beforeEach(() => {
  vi.clearAllMocks();
  headMock.mockResolvedValue({
    contentType: "text/markdown",
    cacheControl: "",
  });
  renameMock.mockResolvedValue(undefined);
  delMock.mockResolvedValue(undefined);
});

describe("folder delete", () => {
  it("tombstones every pathname it removed", async () => {
    listMock.mockResolvedValue({
      blobs: [{ pathname: `${PREFIX}q1.md` }, { pathname: `${PREFIX}q2.md` }],
      hasMore: false,
    });

    const response = await appWith(mountFolderDelete).request("/delete", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "me", folderPath: "reports" }),
    });

    expect(response.status).toBe(204);
    expect(tombstoneManyMock).toHaveBeenCalledTimes(1);
    expect(tombstoneManyMock.mock.calls[0][0]).toMatchObject({
      workspaceId: "workspace-1",
      scope: "user",
      pathnames: [`${PREFIX}q1.md`, `${PREFIX}q2.md`],
    });
  });

  it("does not reach the catalog when there was nothing to delete", async () => {
    listMock.mockResolvedValue({ blobs: [], hasMore: false });

    const response = await appWith(mountFolderDelete).request("/delete", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "me", folderPath: "reports" }),
    });

    expect(response.status).toBe(404);
    expect(tombstoneManyMock).not.toHaveBeenCalled();
  });
});

describe("file move", () => {
  it("follows a single file to its new pathname", async () => {
    // The route reads the source first, then checks the target is free.
    headMock
      .mockResolvedValueOnce({ contentType: "text/markdown", cacheControl: "" })
      .mockRejectedValueOnce(new BlobNotFoundError("gone"));
    listMock.mockResolvedValue({ blobs: [], hasMore: false });

    const response = await appWith(mountMove).request("/move", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        itemType: "file",
        sourcePathname: `${PREFIX}q1.md`,
        targetFolderPath: "archive",
        scope: "me",
      }),
    });

    expect(response.status).toBe(200);
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(reconcileMovesMock).toHaveBeenCalledTimes(1);

    const call = reconcileMovesMock.mock.calls[0][0];
    expect(call).toMatchObject({ workspaceId: "workspace-1", scope: "user" });
    expect(call.moves).toEqual([
      {
        fromPathname: `${PREFIX}q1.md`,
        toPathname: "drive/users/user_123/archive/q1.md",
      },
    ]);
  });
});

describe("folder rename", () => {
  it("follows every file under the renamed prefix", async () => {
    listMock.mockImplementation(({ prefix }: { prefix: string }) =>
      prefix === PREFIX
        ? Promise.resolve({
            blobs: [{ pathname: `${PREFIX}q1.md` }],
            hasMore: false,
          })
        : Promise.resolve({ blobs: [], hasMore: false }),
    );
    // Three head calls, in order: the route first checks no *file* occupies
    // the new folder name, then that the per-file target is free, then reads
    // the source's metadata. The first two must be absent.
    headMock
      .mockRejectedValueOnce(new BlobNotFoundError("gone"))
      .mockRejectedValueOnce(new BlobNotFoundError("gone"))
      .mockResolvedValue({ contentType: "text/markdown", cacheControl: "" });

    const response = await appWith(mountFolderRename).request("/rename", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "me",
        oldFolderPath: "reports",
        newFolderPath: "archive",
      }),
    });

    expect(response.status).toBe(200);
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(reconcileMovesMock).toHaveBeenCalledTimes(1);

    const call = reconcileMovesMock.mock.calls[0][0];
    expect(call).toMatchObject({ workspaceId: "workspace-1", scope: "user" });
    expect(call.moves).toEqual([
      {
        fromPathname: `${PREFIX}q1.md`,
        toPathname: "drive/users/user_123/archive/q1.md",
      },
    ]);
  });
});
