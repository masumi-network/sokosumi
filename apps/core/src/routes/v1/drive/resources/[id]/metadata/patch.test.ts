import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

const CMO_PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const ORDINARY_PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const FILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000f1";

const { updateFileMetadataMock } = vi.hoisted(() => ({
  updateFileMetadataMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: {
      findFirst: async ({ where }: { where: { projectId: string } }) =>
        where.projectId === CMO_PROJECT ? { id: "cuso" } : null,
    },
  },
}));

vi.mock("@/helpers/file-workspace", () => ({
  resolveFileRequestContext: async () => ({
    workspaceId: "ws-1",
    actor: { userId: "user-1", organizationId: "org-1", kind: "user" },
  }),
}));

vi.mock("@/services/file-metadata.service", () => ({
  assertFileEditAllowed: () => undefined,
  updateFileMetadata: updateFileMetadataMock,
}));

const { default: mount } = await import("./patch");

function patch(body: Record<string, unknown>) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user-1",
      organizationId: "org-1",
      role: "user",
    });
    await next();
  });
  mount(app);
  app.onError(errorHandler);
  return app.request(`/${FILE_ID}/metadata?scope=org`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedMetadataRevision: 1, ...body }),
  });
}

describe("PATCH /drive/resources/{id}/metadata on a CMO Project", () => {
  beforeEach(() => {
    updateFileMetadataMock.mockReset();
    updateFileMetadataMock.mockResolvedValue({ status: "not-found" });
  });

  it.each(["confirmProjectIds", "removeProjectIds"])(
    "refuses %s naming a CMO Project",
    async (field) => {
      const response = await patch({
        [field]: [ORDINARY_PROJECT, CMO_PROJECT],
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        kind: "cmo_project_read_only",
      });
      expect(updateFileMetadataMock).not.toHaveBeenCalled();
    },
  );

  it("links a file to an ordinary Project", async () => {
    await patch({ confirmProjectIds: [ORDINARY_PROJECT] });
    expect(updateFileMetadataMock).toHaveBeenCalledTimes(1);
  });

  it("leaves tag edits alone", async () => {
    await patch({ addTagLabelIds: ["label-1"] });
    expect(updateFileMetadataMock).toHaveBeenCalledTimes(1);
  });
});
