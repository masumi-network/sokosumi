import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { StagedUploadStorage } from "@/services/file-catalog.service";

/**
 * Finalize checks the destination against the caller's Drive access before
 * any storage read or move. Without `attemptId` it is the released flow: the
 * bytes are already at the pathname and it activates them. With `attemptId`
 * it publishes exactly that staged attempt.
 *
 * Finalize nudges the background work an upload asked for. A copy's labels
 * are pinned empty, so its finalize runs extraction only and never drains
 * the paid suggestion queue for other files. An ordinary upload keeps both.
 */

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  head: vi.fn(),
  promote: vi.fn(),
  etag: vi.fn(),
  publish: vi.fn(),
  activate: vi.fn(),
  indexing: vi.fn(),
  extraction: vi.fn(),
}));

vi.mock("@/helpers/file-workspace", () => ({
  resolveFileRequestContext: vi.fn().mockResolvedValue({
    workspaceId: "workspace-1",
    scope: "user",
    ownerId: "user_123",
  }),
}));
vi.mock("@/helpers/drive-file-access", () => ({
  requireDriveFileAccess: mocks.access,
}));
vi.mock("@/lib/drive-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drive-blob")>()),
  driveHead: mocks.head,
  promoteStagedUpload: mocks.promote,
  stagedUploadEtag: mocks.etag,
}));
vi.mock("@/services/file-catalog.service", () => ({
  activateDriveUploadResource: mocks.activate,
  publishStagedDriveUpload: mocks.publish,
}));
vi.mock("@/lib/files/in-process-indexer", () => ({
  nudgeFileIndexing: mocks.indexing,
  nudgeFileExtraction: mocks.extraction,
}));

import mountFinalize from "./finalize.js";

const USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

const PATHNAME = "drive/users/user_123/briefs/weekly (copy).md";
const ATTEMPT = "0f9d2c1e-8b7a-4c3d-9e1f-2a3b4c5d6e7f";

function finalize(body: Record<string, unknown> = {}) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("authContext", USER);
    await next();
  });
  mountFinalize(app);
  return app.request("/finalize", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pathname: PATHNAME, scope: "me", ...body }),
  });
}

const STORED = {
  size: 42,
  contentType: "text/markdown",
  access: "public",
  url: `https://blob.example/${PATHNAME}`,
  etag: '"e1"',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ hiddenRoomFolders: [] });
  mocks.head.mockResolvedValue(STORED);
  mocks.promote.mockResolvedValue(true);
  mocks.activate.mockResolvedValue({
    resourceId: "res-1",
    labelsPinnedEmpty: false,
  });
  mocks.publish.mockResolvedValue({
    resourceId: "res-1",
    labelsPinnedEmpty: false,
  });
});

describe("authorization before storage", () => {
  it("checks the destination folder against the caller's Drive access", async () => {
    await finalize();

    expect(mocks.access).toHaveBeenCalledWith(USER, "user", "user_123", {
      into: ["briefs"],
    });
  });

  it("touches no storage when the destination is in a room the caller left", async () => {
    mocks.access.mockRejectedValue(notFound("File not found"));

    expect((await finalize({ attemptId: ATTEMPT })).status).toBe(404);
    expect((await finalize()).status).toBe(404);
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("refuses a pathname outside the authorized store", async () => {
    const response = await finalize({
      pathname: "drive/users/someone_else/notes.md",
    });

    expect(response.status).toBe(404);
    expect(mocks.head).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });
});

describe("the released flow (no attemptId)", () => {
  it("activates bytes a grant PUT straight to the pathname", async () => {
    const response = await finalize();

    expect(response.status).toBe(200);
    expect(mocks.publish).not.toHaveBeenCalled();
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      data: { resourceId: "res-1", fileUrl: STORED.url },
    });
  });

  it("finalizes nothing when no object backs the pathname", async () => {
    mocks.head.mockResolvedValue(null);

    expect((await finalize()).status).toBe(404);
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("finalizes nothing when the current upload is a staged attempt", async () => {
    mocks.activate.mockResolvedValue(null);

    expect((await finalize()).status).toBe(404);
  });
});

describe("the staged flow (attemptId)", () => {
  async function storageFor(): Promise<StagedUploadStorage> {
    await finalize({ attemptId: ATTEMPT });
    return mocks.publish.mock.calls[0][0].storage;
  }

  it("publishes exactly the named attempt", async () => {
    const response = await finalize({ attemptId: ATTEMPT });

    expect(response.status).toBe(200);
    expect(mocks.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: ATTEMPT,
        key: {
          workspaceId: "workspace-1",
          scope: "user",
          ownerId: "user_123",
          pathname: PATHNAME,
        },
      }),
    );
    expect(mocks.activate).not.toHaveBeenCalled();
    expect((await response.json()).data.fileUrl).toBe(STORED.url);
  });

  it("describes the bytes its own move just put on the pathname", async () => {
    const storage = await storageFor();

    await expect(
      storage.promote("drive-staging/a/x.md", null),
    ).resolves.toEqual({ sizeBytes: 42, mimeType: "text/markdown" });
  });

  it("recognises bytes an earlier call moved by the recorded ETag", async () => {
    const storage = await storageFor();
    mocks.promote.mockResolvedValue(false);

    await expect(
      storage.promote("drive-staging/a/x.md", '"e1"'),
    ).resolves.toMatchObject({ sizeBytes: 42 });
  });

  it("never takes another writer's bytes for the attempt's", async () => {
    const storage = await storageFor();
    mocks.promote.mockResolvedValue(false);

    await expect(
      storage.promote("drive-staging/a/x.md", '"other"'),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      storage.promote("drive-staging/a/x.md", null),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("reports nothing uploaded when neither staging nor pathname has bytes", async () => {
    const storage = await storageFor();
    mocks.promote.mockResolvedValue(false);
    mocks.head.mockResolvedValue(null);

    await expect(storage.promote("drive-staging/a/x.md", null)).resolves.toBe(
      null,
    );
  });

  it("hands out no URL for a file in a data room", async () => {
    mocks.head.mockResolvedValue({ ...STORED, access: "private" });

    const body = await (await finalize({ attemptId: ATTEMPT })).json();

    expect(body.data.fileUrl).toBeNull();
  });
});

describe("background work", () => {
  it("runs extraction only for a copy, whose labels are pinned empty", async () => {
    mocks.publish.mockResolvedValue({
      resourceId: "res-1",
      labelsPinnedEmpty: true,
    });

    expect((await finalize({ attemptId: ATTEMPT })).status).toBe(200);
    expect(mocks.extraction).toHaveBeenCalledTimes(1);
    expect(mocks.indexing).not.toHaveBeenCalled();
  });

  it("runs extraction and labelling for an ordinary upload", async () => {
    expect((await finalize()).status).toBe(200);
    expect(mocks.indexing).toHaveBeenCalledTimes(1);
    expect(mocks.extraction).not.toHaveBeenCalled();
  });
});
