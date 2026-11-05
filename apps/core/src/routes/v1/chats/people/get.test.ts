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

const { userFindManyMock, userCountMock } = vi.hoisted(() => ({
  userFindManyMock: vi.fn(),
  userCountMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
    user: { findMany: userFindManyMock, count: userCountMock },
  },
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
    userCountMock.mockReset();
    userCountMock.mockResolvedValue(2);
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

  it("pages through people by cursor", async () => {
    const first = await appFor(null).request("/?limit=1");

    expect(first.status).toBe(200);
    const body = await first.json();
    expect(body.data).toEqual([colleague]);
    expect(body.meta.pagination).toEqual({
      cursor: null,
      limit: 1,
      total: 2,
      nextCursor: "user_bob",
    });

    userFindManyMock.mockResolvedValue([partner]);
    const second = await appFor(null).request("/?limit=1&cursor=user_bob");

    expect(userFindManyMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: { id: "user_bob" }, skip: 1, take: 2 }),
    );
    const secondBody = await second.json();
    expect(secondBody.data).toEqual([partner]);
    expect(secondBody.meta.pagination.nextCursor).toBeNull();
  });
});
