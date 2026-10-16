import { beforeEach, describe, expect, it, vi } from "vitest";
import { forbidden } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import mount from "./get";

const mocks = vi.hoisted(() => ({
  membership: vi.fn(),
  messages: vi.fn(),
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
vi.mock("../../helpers", () => ({
  requireChatRoomUserMembership: mocks.membership,
}));
vi.mock("@/helpers/chat-message-read-budget", () => ({
  assertChatMessageReadBudget: mocks.budget,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { chatRoomMessage: { findMany: mocks.messages } },
}));
vi.mock("@/services/chat-result-preview.service", () => ({
  hydrateChatResultSnapshots: mocks.hydrate,
}));
const roomId = "00000000-0000-4000-8000-000000000001";
const first = "00000000-0000-4000-8000-000000000002";
const second = "00000000-0000-4000-8000-000000000003";
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
describe("batched room result hydration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.membership.mockResolvedValue(undefined);
  });
  it("rejects non-members before reading snapshots", async () => {
    mocks.membership.mockRejectedValue(forbidden("Not a room member"));
    const response = await app().request(
      `/${roomId}/message-results?messageIds=${first}`,
    );
    expect(response.status).toBe(403);
    expect(mocks.budget).not.toHaveBeenCalled();
    expect(mocks.messages).not.toHaveBeenCalled();
  });
  it("spends one read budget token for every requested live message in the room", async () => {
    mocks.messages.mockResolvedValue([
      { id: first, metadata: { result_preview_snapshots: [] } },
      { id: second, metadata: null },
    ]);
    mocks.hydrate.mockResolvedValue([]);
    const response = await app().request(
      `/${roomId}/message-results?messageIds=${first},${second},${first}`,
    );
    expect(response.status).toBe(200);
    expect(mocks.membership).toHaveBeenCalledWith(
      roomId,
      "reader",
      expect.anything(),
    );
    expect(mocks.budget).toHaveBeenCalledTimes(1);
    expect(mocks.budget).toHaveBeenCalledWith("reader");
    expect(mocks.messages).toHaveBeenCalledWith({
      where: { id: { in: [first, second] }, roomId, deletedAt: null },
      select: { id: true, metadata: true },
    });
    expect(mocks.hydrate).toHaveBeenCalledTimes(2);
    expect(mocks.hydrate).toHaveBeenCalledWith([], "reader");
    expect((await response.json()).data).toEqual([
      { messageId: first, results: [] },
      { messageId: second, results: [] },
    ]);
  });
  it("omits missing or deleted messages", async () => {
    mocks.messages.mockResolvedValue([]);
    const response = await app().request(
      `/${roomId}/message-results?messageIds=${first}`,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual([]);
  });
  it("rejects ids that are not uuids and oversized batches", async () => {
    const invalid = await app().request(
      `/${roomId}/message-results?messageIds=nope`,
    );
    expect(invalid.status).toBe(422);
    const ids = Array.from(
      { length: 51 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    const oversized = await app().request(
      `/${roomId}/message-results?messageIds=${ids.join(",")}`,
    );
    expect(oversized.status).toBe(422);
    expect(mocks.messages).not.toHaveBeenCalled();
  });
});
