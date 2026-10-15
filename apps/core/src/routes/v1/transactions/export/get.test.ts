import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mount from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { prismaQueryRawMock } = vi.hoisted(() => ({
  prismaQueryRawMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $queryRaw: prismaQueryRawMock,
    agent: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    });
    return await next();
  });
  mount(app);
  return app;
}

describe("GET /transactions/export", () => {
  beforeEach(() => {
    prismaQueryRawMock.mockReset();
    prismaQueryRawMock.mockResolvedValue([]);
  });

  it("answers a CSV attachment named for the range", async () => {
    const response = await createApp().request(
      "/export?from=2026-09-01&to=2026-09-30",
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="transactions-2026-09-01_2026-09-30.csv"',
    );
    expect(
      (await response.text()).startsWith("date,source,label,credits"),
    ).toBe(true);
  });

  it("includes the whole last day in the query", async () => {
    await (
      await createApp().request("/export?from=2026-09-01&to=2026-09-30")
    ).text();

    const [, ...fragments] = prismaQueryRawMock.mock.calls[0] ?? [];
    const dates = fragments
      .flatMap((fragment) => fragment?.values ?? [])
      .filter((value) => value instanceof Date);
    expect(dates.map((date) => date.toISOString())).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-10-01T00:00:00.000Z",
    ]);
  });

  it("rejects a range that ends before it starts", async () => {
    const response = await createApp().request(
      "/export?from=2026-09-30&to=2026-09-01",
    );

    expect(response.status).toBe(400);
  });

  it("rejects a date that is not a calendar day", async () => {
    const response = await createApp().request("/export?from=2026-13-45");

    expect(response.status).toBe(422);
  });
});
