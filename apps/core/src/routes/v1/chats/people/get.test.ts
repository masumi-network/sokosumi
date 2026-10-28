import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mountGetChatPeople from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { userFindManyMock } = vi.hoisted(() => ({
  userFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findMany: userFindManyMock } },
}));

function appFor(organizationId: string | null) {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("authContext", {
      actor: "user",
      userId: "user_ada",
      organizationId,
      role: "user",
    });
    await next();
  });
  mountGetChatPeople(app);
  return app;
}

const colleague = {
  id: "user_bob",
  name: "Bob",
  email: "bob@example.com",
  image: null,
};
const partner = {
  id: "user_eve",
  name: "Eve",
  email: "eve@partner.example",
  image: "https://example.com/eve.png",
};

describe("GET /chats/people", () => {
  beforeEach(() => {
    userFindManyMock.mockReset();
    userFindManyMock.mockResolvedValue([colleague, partner]);
  });

  it.each([
    ["the personal workspace", null],
    ["an Organization workspace", "org_1"],
  ])(
    "lists everyone the reader may start a Direct with from %s",
    async (_, organizationId) => {
      const response = await appFor(organizationId).request("/");

      expect(response.status).toBe(200);
      expect((await response.json()).data).toEqual([colleague, partner]);
    },
  );

  it("never lists the reader", async () => {
    await appFor(null).request("/");

    expect(userFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: "user_ada" } }),
      }),
    );
  });
});
