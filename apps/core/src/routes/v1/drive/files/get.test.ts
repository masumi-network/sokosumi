import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mountGet from "./get.js";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { listMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  list: listMock,
  head: vi.fn(),
}));

vi.mock("@/helpers/drive-file-access", () => ({
  requireDriveFileAccess: vi.fn().mockResolvedValue(undefined),
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

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
  authenticationMethod: "session",
};

function createFilesApp(
  authContext: AuthenticationContext = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();

  app.onError(errorHandler);

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("requestId", "req_123");
    await next();
  });

  mountGet(app);
  return app;
}

function blobPage(items: {
  folders?: string[];
  blobs?: Array<{
    pathname: string;
    url?: string;
    size?: number;
    uploadedAt: string;
  }>;
  hasMore?: boolean;
  cursor?: string;
}) {
  return {
    folders: items.folders ?? [],
    blobs: (items.blobs ?? []).map((blob) => ({
      url: blob.url ?? `https://blob.example/${blob.pathname}`,
      pathname: blob.pathname,
      size: blob.size ?? 100,
      uploadedAt: new Date(blob.uploadedAt),
    })),
    hasMore: items.hasMore ?? false,
    cursor: items.cursor,
  };
}

describe("GET /v1/drive/files sort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("omits sort and keeps folders-then-files name ascending on a Blob page", async () => {
    listMock.mockResolvedValue(
      blobPage({
        folders: ["drive/users/user_123/Zebra/", "drive/users/user_123/Alpha/"],
        blobs: [
          {
            pathname: "drive/users/user_123/beta.pdf",
            uploadedAt: "2026-01-02T00:00:00.000Z",
          },
          {
            pathname: "drive/users/user_123/alpha.pdf",
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    const app = createFilesApp();
    const response = await app.request("/?scope=me&limit=20");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((item: { name: string }) => item.name)).toEqual([
      "Alpha",
      "Zebra",
      "alpha.pdf",
      "beta.pdf",
    ]);
  });

  it("sorts by date desc with folders first when sortBy=date", async () => {
    listMock.mockResolvedValue(
      blobPage({
        folders: ["drive/users/user_123/Docs/"],
        blobs: [
          {
            pathname: "drive/users/user_123/old.pdf",
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            pathname: "drive/users/user_123/new.pdf",
            uploadedAt: "2026-01-03T00:00:00.000Z",
          },
        ],
      }),
    );

    const app = createFilesApp();
    const response = await app.request(
      "/?scope=me&limit=20&sortBy=date&sortOrder=desc",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.map((item: { name: string }) => item.name)).toEqual([
      "Docs",
      "new.pdf",
      "old.pdf",
    ]);
  });

  it("paginates under an explicit sort without repeating items", async () => {
    listMock.mockResolvedValue(
      blobPage({
        blobs: [
          {
            pathname: "drive/users/user_123/a.pdf",
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
          {
            pathname: "drive/users/user_123/b.pdf",
            uploadedAt: "2026-01-02T00:00:00.000Z",
          },
          {
            pathname: "drive/users/user_123/c.pdf",
            uploadedAt: "2026-01-03T00:00:00.000Z",
          },
        ],
      }),
    );

    const app = createFilesApp();
    const first = await app.request(
      "/?scope=me&limit=2&sortBy=name&sortOrder=asc",
    );
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.data.map((item: { name: string }) => item.name)).toEqual([
      "a.pdf",
      "b.pdf",
    ]);
    expect(firstBody.meta.pagination.nextCursor).toBeTruthy();

    const second = await app.request(
      `/?scope=me&limit=2&sortBy=name&sortOrder=asc&cursor=${encodeURIComponent(firstBody.meta.pagination.nextCursor)}`,
    );
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.data.map((item: { name: string }) => item.name)).toEqual([
      "c.pdf",
    ]);
    expect(secondBody.meta.pagination.nextCursor).toBeNull();
  });

  it("returns 422 for invalid sortBy", async () => {
    const app = createFilesApp();
    const response = await app.request("/?scope=me&sortBy=size");
    expect(response.status).toBe(422);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("returns 422 when Blob pagination stalls during global sort drain", async () => {
    listMock.mockResolvedValue(
      blobPage({
        blobs: [
          {
            pathname: "drive/users/user_123/a.pdf",
            uploadedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        hasMore: true,
      }),
    );

    const app = createFilesApp();
    const response = await app.request(
      "/?scope=me&limit=20&sortBy=name&sortOrder=asc",
    );
    expect(response.status).toBe(422);
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
