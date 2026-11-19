import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

/**
 * Minting an upload: an ordinary file keeps the exact name it was given; a
 * copy (`pinLabelsEmpty`) gets one server-minted name per attempt. The
 * released flow (no `staged`) keeps its grant on the Drive pathname. A staged
 * session, and every copy, writes only the reserved attempt's staging key.
 */

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const mocks = vi.hoisted(() => ({
  grant: vi.fn(),
  reserve: vi.fn(),
}));

vi.mock("@/helpers/drive-file-access", () => ({
  requireUserDriveFileUploadAccess: vi.fn(),
  requireOrganizationDriveFileUploadAccess: vi.fn(),
}));
vi.mock("@/helpers/drive-tasks-workspace", () => ({
  resolveDriveTasksWorkspace: vi
    .fn()
    .mockResolvedValue({ workspaceId: "workspace-1" }),
}));
vi.mock("@/lib/drive-blob", async (importOriginal) => ({
  stagedUploadPathname: (
    await importOriginal<typeof import("@/lib/drive-blob")>()
  ).stagedUploadPathname,
  driveExists: vi.fn().mockResolvedValue(false),
  driveHasAny: vi.fn().mockResolvedValue(false),
  driveWriteStore: vi
    .fn()
    .mockResolvedValue({ access: "public", token: "public-token" }),
}));
vi.mock("@/lib/blob-upload-grant", () => ({
  createBlobUploadGrant: mocks.grant,
}));
vi.mock("@/services/file-catalog.service", () => ({
  reserveDriveUploadResource: mocks.reserve,
}));

import mountPost from "./post.js";

const ATTEMPT = "0f9d2c1e-8b7a-4c3d-9e1f-2a3b4c5d6e7f";

const USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

function mint(body: Record<string, unknown>) {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("authContext", USER);
    await next();
  });
  mountPost(app);
  return app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contentType: "text/markdown",
      size: 42,
      scope: "me",
      folder: "briefs",
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.grant.mockImplementation(async ({ pathname }) => ({
    uploadUrl: "https://blob.test/upload",
    pathname,
    access: "public",
    expiresAt: "2026-11-18T12:00:00.000Z",
  }));
  mocks.reserve.mockResolvedValue({ resourceId: "r", versionId: ATTEMPT });
});

describe("minting an upload", () => {
  it("keeps the released flow: exact name, grant on the Drive pathname", async () => {
    const response = await mint({ filename: "weekly (copy).md" });

    expect(response.status).toBe(201);
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({
          pathname: "drive/users/user_123/briefs/weekly_copy.md",
        }),
        pinLabelsEmpty: undefined,
        staged: false,
      }),
    );
    expect(mocks.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: "drive/users/user_123/briefs/weekly_copy.md",
        addRandomSuffix: false,
      }),
    );
    const { data } = await response.json();
    expect(data.pathname).toBe("drive/users/user_123/briefs/weekly_copy.md");
    expect(data.attemptId).toBeUndefined();
  });

  it("stages an opted-in upload under its own attempt", async () => {
    const response = await mint({ filename: "weekly.md", staged: true });

    expect(response.status).toBe(201);
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ staged: true }),
    );
    expect(mocks.grant.mock.calls[0][0].pathname).toBe(
      `drive-staging/${ATTEMPT}/weekly.md`,
    );
    expect(mocks.reserve.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.grant.mock.invocationCallOrder[0],
    );
    const { data } = await response.json();
    expect(data).toMatchObject({
      pathname: "drive/users/user_123/briefs/weekly.md",
      attemptId: ATTEMPT,
    });
  });

  it("mints no grant when the name is held", async () => {
    mocks.reserve.mockRejectedValue(
      Object.assign(new Error("A file already holds that name"), {
        status: 409,
      }),
    );

    expect((await mint({ filename: "weekly.md" })).status).not.toBe(201);
    expect(mocks.grant).not.toHaveBeenCalled();
  });

  it("binds a copy's grant and pinned reservation to its own minted name", async () => {
    const response = await mint({
      filename: "weekly (copy).md",
      pinLabelsEmpty: true,
    });

    expect(response.status).toBe(201);
    const { pathname } = mocks.reserve.mock.calls[0][0].key;
    const [, id] =
      /^drive\/users\/user_123\/briefs\/weekly_copy_([0-9a-f]{10})\.md$/.exec(
        pathname,
      ) ?? [];
    expect(id).toBeDefined();
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        key: expect.objectContaining({ pathname }),
        displayName: `weekly (copy) ${id}.md`,
        pinLabelsEmpty: { decidedByUserId: "user_123" },
      }),
    );
    expect(mocks.grant.mock.calls[0][0].pathname).toBe(
      `drive-staging/${ATTEMPT}/weekly_copy_${id}.md`,
    );
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.objectContaining({ staged: true }),
    );
    expect((await response.json()).data.pathname).toBe(pathname);
  });
});
