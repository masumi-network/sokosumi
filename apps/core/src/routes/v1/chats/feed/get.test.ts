import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { encodeChatDecisionCursor } from "@/routes/v1/chats/signals/decisions/get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { listChatFeedMock } = vi.hoisted(() => ({
  listChatFeedMock: vi.fn(),
}));
vi.mock("@/services/chat-feed.service", () => ({
  listChatFeed: listChatFeedMock,
}));
vi.mock("@/routes/v1/chats/rooms/helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/routes/v1/chats/rooms/helpers")>()),
  mapChatRoomMessage: () => MESSAGE_DTO,
}));

import mountGetChatFeed from "./get";

const USER_ID = "user-1";
const ORG_ID = "org-1";
const ROOM_ID = "00000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000002";
const CREATED_AT = new Date("2026-11-25T10:00:00.000Z");

/** The DTO the mapper returns; the mapper has its own tests. */
const MESSAGE_DTO = {
  id: MESSAGE_ID,
  roomId: ROOM_ID,
  parentMessageId: null,
  content: "Alice, can you send the pricing sheet?",
  createdAt: CREATED_AT.toISOString(),
  deletedAt: null,
  editedAt: null,
  pinnedAt: null,
  sender: {
    type: "user",
    user: {
      id: "bob",
      name: "Bob",
      email: "bob@sokosumi.test",
      image: null,
      presence: "online",
    },
  },
  mentions: [],
  reactions: [],
  threadReplyCount: 0,
  threadLastReplyAt: null,
  metadata: null,
  quote: null,
  membership: null,
  groupNameChange: null,
  unfurls: null,
  signal: null,
};

function createApp(actor: "user" | "coworker" = "user") {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set(
      "authContext",
      actor === "user"
        ? { actor, userId: USER_ID, organizationId: ORG_ID, role: "user" }
        : { actor, coworkerId: "cw-1", vendorId: "v-1" },
    );
    return await next();
  });
  mountGetChatFeed(app);
  return app;
}

describe("GET /v1/chats/feed", () => {
  beforeEach(() => {
    listChatFeedMock.mockReset();
  });

  it("refuses coworker credentials: the Feed is a reader's own view", async () => {
    const response = await createApp("coworker").request("/");
    expect(response.status).toBe(403);
    expect(listChatFeedMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed cursor", async () => {
    const response = await createApp().request("/?cursor=nope");
    expect(response.status).toBe(400);
    expect(listChatFeedMock).not.toHaveBeenCalled();
  });

  it("reads the page after the cursor and hands back the next position", async () => {
    listChatFeedMock.mockResolvedValue({
      items: [
        {
          lane: "feed",
          room: { id: ROOM_ID, name: "launch", kind: "channel" },
          message: { id: MESSAGE_ID, createdAt: CREATED_AT },
        },
      ],
      hasMore: true,
      unreadCount: 3,
    });
    const after = {
      createdAt: new Date("2026-11-25T11:00:00.000Z"),
      id: "00000000-0000-4000-8000-000000000003",
    };
    const response = await createApp().request(
      `/?limit=1&cursor=${encodeURIComponent(encodeChatDecisionCursor(after))}`,
    );
    expect(response.status).toBe(200);
    expect(listChatFeedMock).toHaveBeenCalledWith(USER_ID, ORG_ID, {
      after,
      take: 1,
    });
    const { data } = await response.json();
    expect(data).toMatchObject({
      items: [{ lane: "feed", message: { id: MESSAGE_ID } }],
      nextCursor: encodeChatDecisionCursor({
        createdAt: CREATED_AT,
        id: MESSAGE_ID,
      }),
      unreadCount: 3,
    });
  });

  it("ends paging on the last page", async () => {
    listChatFeedMock.mockResolvedValue({
      items: [],
      hasMore: false,
      unreadCount: 0,
    });
    const { data } = await (await createApp().request("/")).json();
    expect(data).toEqual({ items: [], nextCursor: null, unreadCount: 0 });
  });
});
