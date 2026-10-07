import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mount from "./get";

const mocks = vi.hoisted(() => ({
  turn: vi.fn(),
  collect: vi.fn(),
  hydrate: vi.fn(),
}));
vi.mock("@/middleware/auth", async (original) => {
  const actual = await original<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
vi.mock("../../../../helpers", async () => {
  const { z } = await import("@hono/zod-openapi");
  return { turnParams: z.object({ turnId: z.string().uuid() }) };
});
vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotTurn: { findFirst: mocks.turn } },
}));
vi.mock("@/services/chat-result-preview.service", () => ({
  collectTurnResultSnapshots: mocks.collect,
  hydrateChatResultSnapshots: mocks.hydrate,
}));
const turnId = "00000000-0000-4000-8000-000000000001";
function app() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("authContext", {
      actor: "user",
      userId: "owner",
      organizationId: null,
      role: "user",
    });
    c.set("requestId", "results");
    await next();
  });
  app.onError(errorHandler);
  mount(app);
  return app;
}
describe("owner result hydration", () => {
  beforeEach(() => vi.clearAllMocks());
  it("queries only a completed turn belonging to the current owner", async () => {
    mocks.turn.mockResolvedValue({ id: turnId });
    mocks.collect.mockResolvedValue([]);
    mocks.hydrate.mockResolvedValue([]);
    const response = await app().request(
      `/me/turns/${turnId}/results?userId=someone-else`,
    );
    expect(response.status).toBe(200);
    expect(mocks.turn).toHaveBeenCalledWith({
      where: { id: turnId, userId: "owner", status: "COMPLETED" },
      select: { id: true },
    });
    expect(mocks.collect).toHaveBeenCalledWith(turnId);
    expect(mocks.hydrate).toHaveBeenCalledWith([], "owner");
  });
  it("does not collect another owner's, missing, or unfinished turn", async () => {
    mocks.turn.mockResolvedValue(null);
    const response = await app().request(`/me/turns/${turnId}/results`);
    expect(response.status).toBe(404);
    expect(mocks.collect).not.toHaveBeenCalled();
  });
});
