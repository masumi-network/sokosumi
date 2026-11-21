import { expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mount from "./get";

const { findMany } = vi.hoisted(() => ({
  findMany: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/helpers/file-workspace", () => ({
  resolveFileRequestContext: async () => ({ workspaceId: "workspace-1" }),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { workspaceLabel: { findMany } },
}));

it.each([
  ["", {}],
  ["&kind=TAG", { kind: "TAG" }],
])("lists workspace labels with query suffix %j", async (suffix, kindWhere) => {
  const app = new OpenAPIHonoWithAuth();
  mount(app);

  const response = await app.request(`/?scope=me${suffix}`);

  expect(response.status).toBe(200);
  expect(findMany.mock.lastCall?.[0].where).toStrictEqual({
    workspaceId: "workspace-1",
    mergedIntoId: null,
    archivedAt: null,
    ...kindWhere,
  });
});
