import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mount from "./get";

const mocks = vi.hoisted(() => ({
  membership: vi.fn(),
  message: vi.fn(),
  hydrate: vi.fn(),
  budget: vi.fn(),
}));
vi.mock("@/middleware/auth", async (original) => {
  const actual = await original<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});
vi.mock("../../../../helpers", () => ({
  requireChatRoomUserMembership: mocks.membership,
}));
vi.mock("@/helpers/chat-message-read-budget", () => ({
  assertChatMessageReadBudget: mocks.budget,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { chatRoomMessage: { findFirst: mocks.message } },
}));
vi.mock("@/services/chat-result-preview.service", () => ({
  hydrateChatResultSnapshots: mocks.hydrate,
}));
const roomId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
function app() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("authContext", {
      actor: "user",
      userId: "reader",
      organizationId: "org",
      role: "user",
    });
    c.set("requestId", "results");
    await next();
  });
  app.onError(errorHandler);
  mount(app);
  return app;
}
describe("room result hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.membership.mockResolvedValue(undefined);
  });
  it("rejects non-members before reading snapshots", async () => {
    mocks.membership.mockRejectedValue(forbidden("Not a room member"));
    const response = await app().request(
      `/${roomId}/messages/${messageId}/results`,
    );
    expect(response.status).toBe(403);
    expect(mocks.message).not.toHaveBeenCalled();
    expect(mocks.hydrate).not.toHaveBeenCalled();
  });
  it("checks membership and reads only a live message in the requested room", async () => {
    mocks.message.mockResolvedValue({
      metadata: { result_preview_snapshots: [{ kind: "future" }] },
    });
    mocks.hydrate.mockResolvedValue([]);
    const response = await app().request(
      `/${roomId}/messages/${messageId}/results`,
    );
    expect(response.status).toBe(200);
    expect(mocks.membership).toHaveBeenCalledWith(
      roomId,
      "reader",
      expect.anything(),
    );
    expect(mocks.budget).toHaveBeenCalledWith("reader");
    expect(mocks.message).toHaveBeenCalledWith({
      where: { id: messageId, roomId, deletedAt: null },
      select: { metadata: true },
    });
    expect(mocks.hydrate).toHaveBeenCalledWith([], "reader");
  });
  it("returns 404 for a missing or deleted message", async () => {
    mocks.message.mockResolvedValue(null);
    const response = await app().request(
      `/${roomId}/messages/${messageId}/results`,
    );
    expect(response.status).toBe(404);
  });
});
