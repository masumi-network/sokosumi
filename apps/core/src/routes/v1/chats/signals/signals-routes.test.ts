import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const views = vi.hoisted(() => ({
  getChatRoomCatchUp: vi.fn(),
  listChatRoomMessagesWithTag: vi.fn(),
  listChatDecisions: vi.fn(),
  listChatNeedsYou: vi.fn(),
  listChatOpenLoops: vi.fn(),
  correctChatMessageSignal: vi.fn(),
  setChatMessageSignalLoop: vi.fn(),
}));
vi.mock("@/services/chat-signal-views.service", () => views);

const {
  getChatCatchUpSummaryMock,
  listImportantChatItemsMock,
  suggestMock,
  answerMock,
} = vi.hoisted(() => ({
  getChatCatchUpSummaryMock: vi.fn(),
  listImportantChatItemsMock: vi.fn(),
  suggestMock: vi.fn(),
  answerMock: vi.fn(),
}));
vi.mock("@/services/chat-catch-up-summary.service", () => ({
  getChatCatchUpSummary: getChatCatchUpSummaryMock,
  listImportantChatItems: listImportantChatItemsMock,
}));
vi.mock("@/services/chat-signal-routing.service", () => ({
  suggestCoworkersForChatMessage: suggestMock,
}));
vi.mock("./messages/updated-message", () => ({
  answerWithUpdatedMessage: answerMock,
}));

import mountGetAllDecisions, {
  encodeChatDecisionCursor,
} from "./decisions/get";
import mountGetImportant from "./important/get";
import mountPutCorrection from "./messages/[messageId]/corrections/put";
import mountPutLoop from "./messages/[messageId]/loop/put";
import mountGetRouting from "./messages/[messageId]/routing/get";
import mountGetNeedsYou from "./needs-you/get";
import mountGetOpenLoops from "./open-loops/get";
import mountGetCatchUp from "./rooms/[id]/catch-up/get";
import mountGetDecisions from "./rooms/[id]/decisions/get";
import mountGetSummary from "./summary/get";

const USER_ID = "user-1";
const ORG_ID = "org-1";
const WORKSPACE_ID = "00000000-0000-4000-8000-0000000000aa";
const ROOM_ID = "00000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000002";

const MESSAGE = {
  id: MESSAGE_ID,
  roomId: ROOM_ID,
  parentMessageId: null,
  content: "Alice, can you send the pricing sheet?",
  createdAt: "2026-10-23T10:00:00.000Z",
  deletedAt: null,
  editedAt: null,
  pinnedAt: null,
  sender: { type: "user", user: { id: "bob", name: "Bob", image: null } },
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
    c.set("workspaceContext", {
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      organizationId: ORG_ID,
    });
    return await next();
  });
  for (const mount of [
    mountGetAllDecisions,
    mountGetNeedsYou,
    mountGetImportant,
    mountGetOpenLoops,
    mountGetSummary,
    mountGetCatchUp,
    mountGetDecisions,
    mountPutCorrection,
    mountPutLoop,
    mountGetRouting,
  ]) {
    mount(app);
  }
  return app;
}

function put(path: string, body: unknown) {
  return createApp().request(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  answerMock.mockResolvedValue(MESSAGE);
});

describe("chat signal routes", () => {
  it("answers a room's catch-up for the session user", async () => {
    views.getChatRoomCatchUp.mockResolvedValue({
      unreadCount: 3,
      taggedCount: 2,
      buckets: [{ bucket: "needsYou", count: 1, messageIds: [MESSAGE_ID] }],
    });
    const response = await createApp().request(`/rooms/${ROOM_ID}/catch-up`);
    expect(response.status).toBe(200);
    expect((await response.json()).data.buckets[0].bucket).toBe("needsYou");
    expect(views.getChatRoomCatchUp).toHaveBeenCalledWith(ROOM_ID, USER_ID);
  });

  it("refuses coworker credentials: signals are a reader's own view", async () => {
    const response = await createApp("coworker").request(
      `/rooms/${ROOM_ID}/catch-up`,
    );
    expect(response.status).toBe(403);
    expect(views.getChatRoomCatchUp).not.toHaveBeenCalled();
  });

  it("pages decisions with the last id as the cursor", async () => {
    views.listChatRoomMessagesWithTag.mockResolvedValue({
      messages: [],
      total: 0,
      nextCursor: null,
    });
    const response = await createApp().request(
      `/rooms/${ROOM_ID}/decisions?limit=5`,
    );
    expect(response.status).toBe(200);
    expect(views.listChatRoomMessagesWithTag).toHaveBeenCalledWith(
      ROOM_ID,
      USER_ID,
      "decisionMade",
      { cursor: undefined, take: 5 },
    );
  });

  it("lists decisions across rooms in the active organization, paged by position", async () => {
    views.listChatDecisions.mockResolvedValue({
      messages: [],
      total: 7,
      hasMore: false,
    });
    const cursor = encodeChatDecisionCursor({
      createdAt: new Date("2026-10-24T09:00:00.000Z"),
      id: MESSAGE_ID,
    });
    const response = await createApp().request(
      `/decisions?limit=1&cursor=${encodeURIComponent(cursor)}`,
    );
    expect(response.status).toBe(200);
    expect(views.listChatDecisions).toHaveBeenCalledWith(USER_ID, ORG_ID, {
      after: {
        createdAt: new Date("2026-10-24T09:00:00.000Z"),
        id: MESSAGE_ID,
      },
      take: 1,
    });
    expect((await response.json()).meta.pagination).toMatchObject({
      total: 7,
      nextCursor: null,
    });
  });

  it("refuses a malformed decisions cursor", async () => {
    const response = await createApp().request("/decisions?cursor=nope");
    expect(response.status).toBe(400);
    expect(views.listChatDecisions).not.toHaveBeenCalled();
  });

  it("refuses coworker credentials for the decisions list", async () => {
    const response = await createApp("coworker").request("/decisions");
    expect(response.status).toBe(403);
    expect(views.listChatDecisions).not.toHaveBeenCalled();
  });

  it("lists needs-you and open loops in the active organization", async () => {
    views.listChatNeedsYou.mockResolvedValue([]);
    views.listChatOpenLoops.mockResolvedValue([]);
    expect((await createApp().request("/needs-you")).status).toBe(200);
    expect((await createApp().request("/open-loops")).status).toBe(200);
    expect(views.listChatNeedsYou).toHaveBeenCalledWith(USER_ID, ORG_ID);
    expect(views.listChatOpenLoops).toHaveBeenCalledWith(USER_ID, ORG_ID);
  });

  it("lists the last day's important messages for Home", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-10T12:00:00Z") });
    listImportantChatItemsMock.mockResolvedValue([
      {
        messageId: MESSAGE_ID,
        roomId: ROOM_ID,
        roomName: "launch",
        roomKind: "channel",
        parentMessageId: null,
        senderName: "Bob",
        senderImageUrl: null,
        excerpt: "Alice, can you send the pricing sheet?",
        bucket: "needsYou",
        createdAt: new Date("2026-11-10T10:00:00Z"),
        dueAt: null,
        inReplyTo: null,
      },
    ]);
    const response = await createApp().request("/important");
    vi.useRealTimers();
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].senderName).toBe("Bob");
    expect(listImportantChatItemsMock).toHaveBeenCalledWith({
      userId: USER_ID,
      organizationId: ORG_ID,
      since: new Date("2026-11-09T12:00:00Z"),
      limit: 8,
    });
  });

  it("scopes the summary to one room when asked", async () => {
    getChatCatchUpSummaryMock.mockResolvedValue({
      scope: ROOM_ID,
      unreadTaggedCount: 0,
      unreadMessageCount: 0,
      unreadRoomCount: 0,
      awaySince: null,
      counts: [],
      headline: null,
      topics: [],
      quietRooms: [],
      generatedAt: null,
      needsYou: [],
      blockers: [],
      decisions: [],
      announcements: [],
      openLoops: [],
      highlights: [],
    });
    const response = await createApp().request(`/summary?roomId=${ROOM_ID}`);
    expect(response.status).toBe(200);
    expect(getChatCatchUpSummaryMock).toHaveBeenCalledWith({
      userId: USER_ID,
      organizationId: ORG_ID,
      roomId: ROOM_ID,
    });
  });

  it("stores a correction and answers with the message", async () => {
    const response = await put(`/messages/${MESSAGE_ID}/corrections`, {
      tag: "question",
      applies: false,
    });
    expect(response.status).toBe(200);
    expect(views.correctChatMessageSignal).toHaveBeenCalledWith({
      messageId: MESSAGE_ID,
      userId: USER_ID,
      tag: "question",
      applies: false,
    });
    expect((await response.json()).data.id).toBe(MESSAGE_ID);
  });

  it("rejects a tag outside the vocabulary", async () => {
    const response = await put(`/messages/${MESSAGE_ID}/corrections`, {
      tag: "spam",
      applies: true,
    });
    expect(response.status).toBe(422);
    expect(views.correctChatMessageSignal).not.toHaveBeenCalled();
  });

  it("closes a loop into a Task of the viewer's workspace", async () => {
    const taskId = "00000000-0000-4000-8000-000000000003";
    const response = await put(`/messages/${MESSAGE_ID}/loop`, {
      closed: true,
      taskId,
    });
    expect(response.status).toBe(200);
    expect(views.setChatMessageSignalLoop).toHaveBeenCalledWith({
      messageId: MESSAGE_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
      closed: true,
      taskId,
    });
  });

  it("suggests coworkers in the viewer's workspace", async () => {
    suggestMock.mockResolvedValue([
      { coworkerId: "cw-1", name: "Researcher", caption: null, fit: 0.9 },
    ]);
    const response = await createApp().request(
      `/messages/${MESSAGE_ID}/routing`,
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data[0].coworkerId).toBe("cw-1");
    expect(suggestMock).toHaveBeenCalledWith({
      messageId: MESSAGE_ID,
      userId: USER_ID,
      workspaceId: WORKSPACE_ID,
    });
  });
});
