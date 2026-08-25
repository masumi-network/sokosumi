import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountRemoveChatRoomMessageUnfurl from "./post";

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  messageFindFirstMock,
  queryRawMock,
  prismaTransactionMock,
  mergeMetadataKeysMock,
  deleteMetadataKeysMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  queryRawMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  mergeMetadataKeysMock: vi.fn(),
  deleteMetadataKeysMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@/helpers/chat-room-message-metadata-patch", () => ({
  mergeChatRoomMessageMetadataKeys: (...args: unknown[]) =>
    mergeMetadataKeysMock(...args),
  deleteChatRoomMessageMetadataKeys: (...args: unknown[]) =>
    deleteMetadataKeysMock(...args),
}));

const { publishChatRoomMessageRealtimeMock } = vi.hoisted(() => ({
  publishChatRoomMessageRealtimeMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: publishChatRoomMessageRealtimeMock,
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const OTHER_USER_ID = "user_456";
const ABLY_URL = "https://ably.com/platform";
const RESEND_URL = "https://resend.com";

const tx = {
  $queryRaw: queryRawMock,
  chatRoom: {
    findFirst: roomFindFirstMock,
  },
  organization: {
    findUnique: organizationFindUniqueMock,
  },
  member: {
    findUnique: memberFindUniqueMock,
  },
  chatRoomMessage: {
    findFirst: messageFindFirstMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountRemoveChatRoomMessageUnfurl(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

const coworkerAuthContext: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: "coworker_1",
  vendorId: "vendor_1",
};

const ablyCard = {
  url: ABLY_URL,
  title: "Ably",
  description: "Realtime",
  imageUrl: "https://cdn.example/ably.png",
  siteName: "Ably",
};

const resendCard = {
  url: RESEND_URL,
  title: "Resend",
  description: null,
  imageUrl: null,
  siteName: "Resend",
};

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    roomId: ROOM_ID,
    parentMessageId: null,
    content: `see ${ABLY_URL} and ${RESEND_URL}`,
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    deletedAt: null,
    editedAt: null,
    senderUserId: USER_ID,
    senderCoworkerId: null,
    metadata: { unfurls: [ablyCard, resendCard] },
    clientMessageId: null,
    responsesApiResponseId: null,
    senderUser: {
      id: USER_ID,
      name: "Ada",
      email: "ada@example.com",
      image: null,
      sessions: [],
    },
    senderCoworker: null,
    mentionsAsSource: [],
    reactions: [],
    _count: { replies: 0 },
    replies: [],
    ...overrides,
  };
}

async function removeUnfurl(url: string, auth = userAuthContext) {
  const app = createApp(auth);
  return app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}/unfurls/remove`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

describe("POST /chats/rooms/:id/messages/:messageId/unfurls/remove", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      kind: "channel",
      name: "general",
      archivedAt: null,
      userMembers: [{ userId: USER_ID }],
      coworkerMembers: [],
    });
    organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
    memberFindUniqueMock.mockResolvedValue({
      id: "member_1",
      userId: USER_ID,
      organizationId: "org_1",
      role: "member",
    });
    messageFindFirstMock.mockResolvedValue(baseMessage());
    queryRawMock.mockResolvedValue([{ id: MESSAGE_ID }]);
    mergeMetadataKeysMock.mockResolvedValue(1);
    deleteMetadataKeysMock.mockResolvedValue(1);
  });

  it("removes one unfurl for the author without marking the message edited", async () => {
    const response = await removeUnfurl(ABLY_URL);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.unfurls).toEqual([resendCard]);
    expect(body.data.editedAt).toBeNull();
    expect(body.data.content).toBe(`see ${ABLY_URL} and ${RESEND_URL}`);
    expect(mergeMetadataKeysMock).toHaveBeenCalledWith({
      client: tx,
      messageId: MESSAGE_ID,
      patch: {
        unfurls: [resendCard],
        removedUnfurlUrls: [ABLY_URL],
      },
    });
    expect(deleteMetadataKeysMock).not.toHaveBeenCalled();
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: MESSAGE_ID }),
      "unfurl",
    );
  });

  it("locks the message with FOR UPDATE before applying the remove", async () => {
    const callOrder: string[] = [];
    queryRawMock.mockImplementation(async () => {
      callOrder.push("lock");
      return [{ id: MESSAGE_ID }];
    });
    mergeMetadataKeysMock.mockImplementation(async () => {
      callOrder.push("merge");
      return 1;
    });

    const response = await removeUnfurl(ABLY_URL);

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(["lock", "merge"]);
    const sqlParts = queryRawMock.mock.calls[0]?.[0] as TemplateStringsArray;
    expect(sqlParts.join(" ")).toContain("FOR UPDATE");
  });

  it("is idempotent when that unfurl is already removed", async () => {
    messageFindFirstMock.mockResolvedValue(
      baseMessage({
        metadata: {
          unfurls: [resendCard],
          removedUnfurlUrls: [ABLY_URL],
        },
      }),
    );

    const response = await removeUnfurl(ABLY_URL);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.unfurls).toEqual([resendCard]);
    expect(mergeMetadataKeysMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the URL is not an unfurl on the message", async () => {
    const response = await removeUnfurl("https://example.com/missing");

    expect(response.status).toBe(400);
    expect(mergeMetadataKeysMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the caller is not the message author", async () => {
    messageFindFirstMock.mockResolvedValue(
      baseMessage({
        senderUserId: OTHER_USER_ID,
        senderUser: {
          id: OTHER_USER_ID,
          name: "Bob",
          email: "bob@example.com",
          image: null,
          sessions: [],
        },
      }),
    );

    const response = await removeUnfurl(ABLY_URL);

    expect(response.status).toBe(403);
    expect(mergeMetadataKeysMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the message was sent by a coworker", async () => {
    messageFindFirstMock.mockResolvedValue(
      baseMessage({
        senderUserId: null,
        senderCoworkerId: "coworker_1",
        senderUser: null,
        senderCoworker: {
          id: "coworker_1",
          name: "Jamal",
          slug: "jamal",
          caption: null,
          image: null,
        },
      }),
    );

    const response = await removeUnfurl(ABLY_URL);

    expect(response.status).toBe(403);
    expect(mergeMetadataKeysMock).not.toHaveBeenCalled();
  });

  it("returns 403 for coworker actors", async () => {
    const response = await removeUnfurl(ABLY_URL, coworkerAuthContext);

    expect(response.status).toBe(403);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the message is deleted", async () => {
    messageFindFirstMock.mockResolvedValue(
      baseMessage({
        content: "",
        deletedAt: new Date("2026-08-02T05:00:00.000Z"),
        metadata: null,
      }),
    );

    const response = await removeUnfurl(ABLY_URL);

    expect(response.status).toBe(403);
    expect(mergeMetadataKeysMock).not.toHaveBeenCalled();
  });
});
