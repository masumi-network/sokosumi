import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMock, queryRawMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  queryRawMock: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ list: listMock }));
vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
vi.mock("@/lib/db/prisma", () => ({ default: { $queryRaw: queryRawMock } }));
vi.mock("@/helpers/file-workspace", () => ({
  resolveFileRequestContext: vi.fn().mockResolvedValue({
    workspaceId: "ws_1",
    scope: "organization",
    ownerId: "org_1",
  }),
}));
vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return {
    ...actual,
    getEnv: () => ({ ...actual.getEnv(), BLOB_READ_WRITE_TOKEN: "t" }),
  };
});

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGet from "./get.js";

function app() {
  const instance = new OpenAPIHonoWithAuth();
  instance.use("*", async (c, next) => {
    c.set("authContext", {
      actor: "user",
      userId: "u1",
      organizationId: "org_1",
      role: "user",
      authenticationMethod: "session",
    });
    await next();
  });
  mountGet(instance);
  return instance;
}

describe("GET /v1/drive/folders", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists an empty folder made with New folder", async () => {
    queryRawMock.mockResolvedValue([{ folder: "Marketing/Q4" }]);
    listMock.mockResolvedValue({
      blobs: [
        { pathname: "drive/organizations/org_1/Marketing/Q4/plan.md" },
        {
          pathname:
            "drive/organizations/org_1/Masumi Fundraising/__drive_folder__",
        },
      ],
      hasMore: false,
    });

    const response = await app().request("/?scope=org&organizationId=org_1");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: string[] };
    expect(body.data).toEqual([
      "Marketing",
      "Marketing/Q4",
      "Masumi Fundraising",
    ]);
  });

  it("keeps the catalog's folders when storage is unavailable", async () => {
    queryRawMock.mockResolvedValue([{ folder: "Media" }]);
    listMock.mockRejectedValue(new Error("down"));
    const response = await app().request("/?scope=org&organizationId=org_1");
    const body = (await response.json()) as { data: string[] };
    expect(body.data).toEqual(["Media"]);
  });
});
