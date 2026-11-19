import { describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import mountPutTaskView from "./put";

const { upsertMock } = vi.hoisted(() => ({ upsertMock: vi.fn() }));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { taskViewPreference: { upsert: upsertMock } },
}));

const USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
  role: "user",
};

function put(body: unknown, authContext: AuthenticationContext = USER) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: "11111111-1111-7111-8111-111111111111",
      userId: null,
      organizationId: "org_123",
    });
    await next();
  });
  mountPutTaskView(app);
  return app.request("http://localhost/view", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("PUT /tasks/view", () => {
  it.each([
    ["markup", 'status="><script>'],
    ["spaces", "status=READY a"],
    ["too long", `q=${"a".repeat(1000)}`],
  ])("refuses a query with %s", async (_case, query) => {
    const response = await put({ query });

    expect(response.status).toBe(422);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("refuses a coworker token that carries a user", async () => {
    const response = await put(
      { query: "status=READY" },
      {
        actor: "coworker",
        coworkerId: "cow_123",
        vendorId: "01960001-0001-7001-8001-000000000001",
        context: { userId: "user_123", organizationId: "org_123" },
      },
    );

    expect(response.status).toBe(403);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});
