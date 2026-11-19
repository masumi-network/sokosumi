import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

/**
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
vi.mock("@/lib/drive-blob", () => ({ driveHead: mocks.head }));
vi.mock("@/services/file-catalog.service", () => ({
  activateDriveUploadResource: mocks.activate,
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

beforeEach(() => {
  vi.clearAllMocks();
  mocks.head.mockResolvedValue({ size: 42, contentType: "text/markdown" });
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
