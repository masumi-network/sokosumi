import { beforeEach, describe, expect, it, vi } from "vitest";

import { conflict } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

/**
 * Finalize promotes the attempt's own staged bytes onto the Drive pathname,
 * then activates the document. Bytes reach a Drive pathname only through the
 * version the catalog says is being uploaded there.
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
  head: vi.fn(),
  promote: vi.fn(),
  version: vi.fn(),
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
vi.mock("@/lib/drive-blob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/drive-blob")>()),
  driveHead: mocks.head,
  promoteStagedUpload: mocks.promote,
}));
vi.mock("@/services/file-catalog.service", () => ({
  activateDriveUploadResource: mocks.activate,
  currentDriveUploadVersion: mocks.version,
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

function finalize() {
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
    body: JSON.stringify({
      pathname: "drive/users/user_123/weekly (copy).md",
      scope: "me",
    }),
  });
}

const PATHNAME = "drive/users/user_123/weekly (copy).md";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.head.mockResolvedValue({
    size: 42,
    contentType: "text/markdown",
    access: "public",
    url: `https://blob.example/${PATHNAME}`,
  });
  mocks.version.mockResolvedValue("ver_1");
  mocks.promote.mockResolvedValue(true);
  mocks.activate.mockResolvedValue({
    resourceId: "res-1",
    labelsPinnedEmpty: false,
  });
});

describe("promotion", () => {
  it("moves this version's staged bytes onto the pathname before activating", async () => {
    const response = await finalize();

    expect(response.status).toBe(200);
    expect(mocks.promote).toHaveBeenCalledWith(
      "drive-staging/ver_1/weekly (copy).md",
      PATHNAME,
    );
    expect(mocks.promote.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activate.mock.invocationCallOrder[0],
    );
    expect(await response.json()).toMatchObject({
      data: {
        resourceId: "res-1",
        fileUrl: `https://blob.example/${PATHNAME}`,
      },
    });
  });

  it("hands out no URL for a file in a data room", async () => {
    mocks.head.mockResolvedValue({
      size: 42,
      contentType: "application/pdf",
      access: "private",
      url: "https://private.example/x",
    });

    const body = await (await finalize()).json();

    expect(body.data.fileUrl).toBeNull();
  });

  it("finalizes nothing when no document holds the pathname", async () => {
    mocks.version.mockResolvedValue(null);

    expect((await finalize()).status).toBe(404);
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("refuses, keeping the staged bytes, when something else is at the pathname", async () => {
    mocks.promote.mockRejectedValue(
      conflict("Another file is already at that path"),
    );

    expect((await finalize()).status).toBe(409);
    expect(mocks.activate).not.toHaveBeenCalled();
  });

  it("finalizes nothing when neither the attempt nor the pathname has bytes", async () => {
    mocks.promote.mockResolvedValue(false);
    mocks.head.mockResolvedValue(null);

    expect((await finalize()).status).toBe(404);
    expect(mocks.activate).not.toHaveBeenCalled();
  });
});

describe("finalize", () => {
  it("runs extraction only for a copy, whose labels are pinned empty", async () => {
    mocks.activate.mockResolvedValue({
      resourceId: "res-1",
      labelsPinnedEmpty: true,
    });

    expect((await finalize()).status).toBe(200);
    expect(mocks.extraction).toHaveBeenCalledTimes(1);
    expect(mocks.indexing).not.toHaveBeenCalled();
  });

  it("runs extraction and labelling for an ordinary upload", async () => {
    mocks.activate.mockResolvedValue({
      resourceId: "res-1",
      labelsPinnedEmpty: false,
    });

    expect((await finalize()).status).toBe(200);
    expect(mocks.indexing).toHaveBeenCalledTimes(1);
    expect(mocks.extraction).not.toHaveBeenCalled();
  });
});
