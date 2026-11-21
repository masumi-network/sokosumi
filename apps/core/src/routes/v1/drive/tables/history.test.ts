import { expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mount from "./history";

const { count, findMany } = vi.hoisted(() => ({
  count: vi.fn().mockResolvedValue(0),
  findMany: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/helpers/data-table", () => ({
  requireDataTable: vi.fn(),
}));
vi.mock("./context", () => ({
  tableActor: async () => ({ actorKind: "user" }),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    tableChange: { count, findMany },
    user: { findMany: vi.fn().mockResolvedValue([]) },
    sokoBot: { findMany: vi.fn().mockResolvedValue([]) },
    coworker: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

const tableId = "11111111-1111-4111-8111-111111111111";
const rowId = "22222222-2222-4222-8222-222222222222";

it.each([
  ["", {}],
  [`?rowId=${rowId}`, { rowId }],
])("lists table history with query %j", async (query, rowWhere) => {
  const app = new OpenAPIHonoWithAuth();
  mount(app);

  const response = await app.request(`/${tableId}/history${query}`);

  expect(response.status).toBe(200);
  const where = { tableId, ...rowWhere };
  expect(count.mock.lastCall?.[0]).toStrictEqual({ where });
  expect(findMany.mock.lastCall?.[0].where).toStrictEqual(where);
});
