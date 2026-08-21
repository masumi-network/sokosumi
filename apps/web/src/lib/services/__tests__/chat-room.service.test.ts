import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getChatRoomsMock = vi.fn();
const getDiscoverableChatRoomsMock = vi.fn();
const getChatRoomThreadsMock = vi.fn();
const getChatRoomThreadsUnreadCountMock = vi.fn();
const markChatRoomThreadReadMock = vi.fn();
const markChatRoomThreadsReadMock = vi.fn();
const archiveChatRoomMock = vi.fn();
const deleteChatRoomMock = vi.fn();
const leaveChatRoomMock = vi.fn();
const joinChatRoomMock = vi.fn();
const restoreChatRoomMock = vi.fn();

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;
    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.status = options?.status;
    }
  },
  coreClient: {
    getChatRooms: (...args: unknown[]) => getChatRoomsMock(...args),
    getDiscoverableChatRooms: (...args: unknown[]) =>
      getDiscoverableChatRoomsMock(...args),
    getChatRoomThreads: (...args: unknown[]) => getChatRoomThreadsMock(...args),
    getChatRoomThreadsUnreadCount: (...args: unknown[]) =>
      getChatRoomThreadsUnreadCountMock(...args),
    markChatRoomThreadRead: (...args: unknown[]) =>
      markChatRoomThreadReadMock(...args),
    markChatRoomThreadsRead: (...args: unknown[]) =>
      markChatRoomThreadsReadMock(...args),
    archiveChatRoom: (...args: unknown[]) => archiveChatRoomMock(...args),
    deleteChatRoom: (...args: unknown[]) => deleteChatRoomMock(...args),
    leaveChatRoom: (...args: unknown[]) => leaveChatRoomMock(...args),
    joinChatRoom: (...args: unknown[]) => joinChatRoomMock(...args),
    restoreChatRoom: (...args: unknown[]) => restoreChatRoomMock(...args),
  },
}));

function room(id: string) {
  return {
    id,
    name: id,
    slug: id,
    kind: "channel" as const,
  };
}

function emptyPage(
  data: ReturnType<typeof room>[],
  nextCursor: string | null = null,
) {
  return {
    data,
    meta: {
      pagination: {
        cursor: null,
        limit: 100,
        total: data.length,
        nextCursor,
      },
    },
  };
}

describe("chatRoomService.listRooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("walks nextCursor until exhausted and returns the full set", async () => {
    getChatRoomsMock
      .mockResolvedValueOnce(
        emptyPage([room("room-1"), room("room-2")], "room-2"),
      )
      .mockResolvedValueOnce(emptyPage([room("room-3")]));

    const { chatRoomService } = await import("../chat-room.service");
    const page = await chatRoomService.listRooms();

    expect(page.rooms.map((item) => item.id)).toEqual([
      "room-1",
      "room-2",
      "room-3",
    ]);
    expect(page.nextCursor).toBeNull();
    expect(getChatRoomsMock).toHaveBeenCalledTimes(2);
    expect(getChatRoomsMock).toHaveBeenNthCalledWith(1, {
      limit: 100,
      status: "active",
    });
    expect(getChatRoomsMock).toHaveBeenNthCalledWith(2, {
      limit: 100,
      status: "active",
      cursor: "room-2",
    });
  });

  it("passes kind filter on every page", async () => {
    getChatRoomsMock
      .mockResolvedValueOnce(emptyPage([room("dm-1")], "dm-1"))
      .mockResolvedValueOnce(emptyPage([room("dm-2")]));

    const { chatRoomService } = await import("../chat-room.service");
    await chatRoomService.listRooms("direct");

    expect(getChatRoomsMock).toHaveBeenNthCalledWith(1, {
      limit: 100,
      status: "active",
      kind: "direct",
    });
    expect(getChatRoomsMock).toHaveBeenNthCalledWith(2, {
      limit: 100,
      status: "active",
      kind: "direct",
      cursor: "dm-1",
    });
  });

  it("stops when nextCursor does not advance", async () => {
    getChatRoomsMock.mockResolvedValue(emptyPage([room("room-1")], "room-1"));

    const { chatRoomService } = await import("../chat-room.service");
    const page = await chatRoomService.listRooms();

    expect(page.rooms.map((item) => item.id)).toEqual(["room-1"]);
    expect(page.nextCursor).toBeNull();
    expect(getChatRoomsMock).toHaveBeenCalledTimes(2);
    expect(getChatRoomsMock).toHaveBeenNthCalledWith(1, {
      limit: 100,
      status: "active",
    });
    expect(getChatRoomsMock).toHaveBeenNthCalledWith(2, {
      limit: 100,
      status: "active",
      cursor: "room-1",
    });
  });

  it("passes archived status when listing archived rooms", async () => {
    getChatRoomsMock.mockResolvedValue(emptyPage([room("archived-1")]));

    const { chatRoomService } = await import("../chat-room.service");
    const page = await chatRoomService.listRooms("channel", "archived");

    expect(page.rooms.map((item) => item.id)).toEqual(["archived-1"]);
    expect(page.nextCursor).toBeNull();
    expect(getChatRoomsMock).toHaveBeenCalledWith({
      limit: 100,
      status: "archived",
      kind: "channel",
    });
  });
});

describe("chatRoomService.listDiscoverableChannels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("walks nextCursor until exhausted", async () => {
    getDiscoverableChatRoomsMock
      .mockResolvedValueOnce({
        data: [
          {
            id: "room-1",
            name: "Alpha",
            slug: "alpha",
            topic: null,
            discoverability: "public",
            memberCount: 3,
            createdByUserId: "user-1",
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
        meta: {
          pagination: {
            cursor: null,
            limit: 100,
            total: 2,
            nextCursor: "room-1",
          },
        },
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "room-2",
            name: "Beta",
            slug: "beta",
            topic: "Planning",
            discoverability: "public",
            memberCount: 5,
            createdByUserId: "user-2",
            createdAt: new Date("2026-01-02T00:00:00.000Z"),
            updatedAt: new Date("2026-01-02T00:00:00.000Z"),
          },
        ],
        meta: {
          pagination: {
            cursor: "room-1",
            limit: 100,
            total: 2,
            nextCursor: null,
          },
        },
      });

    const { chatRoomService } = await import("../chat-room.service");
    const rooms = await chatRoomService.listDiscoverableChannels();

    expect(rooms.map((item) => item.id)).toEqual(["room-1", "room-2"]);
    expect(getDiscoverableChatRoomsMock).toHaveBeenCalledTimes(2);
    expect(getDiscoverableChatRoomsMock).toHaveBeenNthCalledWith(1, {
      limit: 100,
    });
    expect(getDiscoverableChatRoomsMock).toHaveBeenNthCalledWith(2, {
      limit: 100,
      cursor: "room-1",
    });
  });

  it("passes q filter on every page", async () => {
    getDiscoverableChatRoomsMock.mockResolvedValue({
      data: [],
      meta: {
        pagination: {
          cursor: null,
          limit: 100,
          total: 0,
          nextCursor: null,
        },
      },
    });

    const { chatRoomService } = await import("../chat-room.service");
    await chatRoomService.listDiscoverableChannels({ q: " launch " });

    expect(getDiscoverableChatRoomsMock).toHaveBeenCalledWith({
      limit: 100,
      q: "launch",
    });
  });

  it("stops after maxPages for sidebar suggestions", async () => {
    getDiscoverableChatRoomsMock.mockResolvedValue({
      data: [
        {
          id: "room-1",
          name: "Alpha",
          slug: "alpha",
          topic: null,
          discoverability: "public",
          memberCount: 3,
          createdByUserId: "user-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ],
      meta: {
        pagination: {
          cursor: null,
          limit: 100,
          total: 2,
          nextCursor: "room-1",
        },
      },
    });

    const { chatRoomService } = await import("../chat-room.service");
    const rooms = await chatRoomService.listDiscoverableChannels({
      maxPages: 1,
    });

    expect(rooms.map((item) => item.id)).toEqual(["room-1"]);
    expect(getDiscoverableChatRoomsMock).toHaveBeenCalledTimes(1);
  });
});

describe("chatRoomService.listArchivedRooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("walks archived organization channels until exhausted", async () => {
    getChatRoomsMock
      .mockResolvedValueOnce(emptyPage([room("archived-1")], "archived-1"))
      .mockResolvedValueOnce(emptyPage([room("archived-2")]));

    const { chatRoomService } = await import("../chat-room.service");
    const page = await chatRoomService.listArchivedRooms();

    expect(page.rooms.map((item) => item.id)).toEqual([
      "archived-1",
      "archived-2",
    ]);
    expect(page.nextCursor).toBeNull();
    expect(getChatRoomsMock).toHaveBeenCalledTimes(2);
    expect(getChatRoomsMock).toHaveBeenNthCalledWith(1, {
      limit: 100,
      status: "archived",
      kind: "channel",
    });
    expect(getChatRoomsMock).toHaveBeenNthCalledWith(2, {
      limit: 100,
      status: "archived",
      kind: "channel",
      cursor: "archived-1",
    });
  });
});

describe("chatRoomService lifecycle wrappers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("archiveRoom returns Core archive payload", async () => {
    archiveChatRoomMock.mockResolvedValue({
      data: {
        id: "room-1",
        archivedAt: "2026-02-02T10:00:00.000Z",
      },
    });

    const { chatRoomService } = await import("../chat-room.service");
    const result = await chatRoomService.archiveRoom("room-1");

    expect(archiveChatRoomMock).toHaveBeenCalledWith("room-1");
    expect(result).toEqual({
      id: "room-1",
      archivedAt: "2026-02-02T10:00:00.000Z",
    });
  });

  it("leaveRoom returns Core leave payload", async () => {
    leaveChatRoomMock.mockResolvedValue({
      data: { id: "room-1", remainingUserMemberCount: 2 },
    });

    const { chatRoomService } = await import("../chat-room.service");
    const result = await chatRoomService.leaveRoom("room-1");

    expect(leaveChatRoomMock).toHaveBeenCalledWith("room-1");
    expect(result).toEqual({ id: "room-1", remainingUserMemberCount: 2 });
  });

  it("joinRoom returns joined room", async () => {
    joinChatRoomMock.mockResolvedValue({
      data: room("room-1"),
    });

    const { chatRoomService } = await import("../chat-room.service");
    const result = await chatRoomService.joinRoom("room-1");

    expect(joinChatRoomMock).toHaveBeenCalledWith("room-1");
    expect(result).toEqual(room("room-1"));
  });

  it("restoreRoom returns restored room", async () => {
    restoreChatRoomMock.mockResolvedValue({
      data: room("room-1"),
    });

    const { chatRoomService } = await import("../chat-room.service");
    const result = await chatRoomService.restoreRoom("room-1");

    expect(restoreChatRoomMock).toHaveBeenCalledWith("room-1");
    expect(result).toEqual(room("room-1"));
  });

  it("deleteRoom calls Core permanent delete", async () => {
    deleteChatRoomMock.mockResolvedValue(undefined);

    const { chatRoomService } = await import("../chat-room.service");
    await chatRoomService.deleteRoom("room-1");

    expect(deleteChatRoomMock).toHaveBeenCalledWith("room-1");
  });
});

describe("chatRoomService thread attention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("listThreads returns a recency page without unread filter", async () => {
    const items = [
      {
        parentMessage: { id: "msg-1" },
        unreadReplyCount: 1,
        lastUnreadReplyAt: new Date("2026-08-01T01:00:00.000Z"),
      },
      {
        parentMessage: { id: "msg-2" },
        unreadReplyCount: 0,
        lastUnreadReplyAt: null,
      },
    ];
    getChatRoomThreadsMock.mockResolvedValue({
      data: items,
      meta: { pagination: { nextCursor: "msg-2", total: 3, limit: 50 } },
    });

    const { chatRoomService } = await import("../chat-room.service");
    const result = await chatRoomService.listThreads("room-1");

    expect(getChatRoomThreadsMock).toHaveBeenCalledWith("room-1", {
      limit: 50,
    });
    expect(result).toEqual({
      threads: items,
      nextCursor: "msg-2",
    });
  });

  it("listThreads passes cursor when loading older", async () => {
    getChatRoomThreadsMock.mockResolvedValue({
      data: [],
      meta: { pagination: { nextCursor: null } },
    });

    const { chatRoomService } = await import("../chat-room.service");
    await chatRoomService.listThreads("room-1", { cursor: "msg-2" });

    expect(getChatRoomThreadsMock).toHaveBeenCalledWith("room-1", {
      limit: 50,
      cursor: "msg-2",
    });
  });

  it("listThreads propagates Core client rejection", async () => {
    getChatRoomThreadsMock.mockRejectedValue(new Error("network"));

    const { chatRoomService } = await import("../chat-room.service");
    await expect(chatRoomService.listThreads("room-1")).rejects.toThrow(
      "network",
    );
  });

  it("countUnreadThreads returns Core unread thread count without listing threads", async () => {
    getChatRoomThreadsUnreadCountMock.mockResolvedValue({
      data: { count: 4 },
    });

    const { chatRoomService } = await import("../chat-room.service");
    const result = await chatRoomService.countUnreadThreads("room-1");

    expect(getChatRoomThreadsUnreadCountMock).toHaveBeenCalledWith("room-1");
    expect(getChatRoomThreadsMock).not.toHaveBeenCalled();
    expect(result).toBe(4);
  });

  it("countUnreadThreads propagates Core client rejection", async () => {
    getChatRoomThreadsUnreadCountMock.mockRejectedValue(new Error("network"));

    const { chatRoomService } = await import("../chat-room.service");
    await expect(chatRoomService.countUnreadThreads("room-1")).rejects.toThrow(
      "network",
    );
    expect(getChatRoomThreadsMock).not.toHaveBeenCalled();
  });

  it("markThreadRead posts look state for parent message", async () => {
    const state = {
      parentMessageId: "msg-1",
      lastReadAt: new Date("2026-08-01T02:00:00.000Z"),
    };
    markChatRoomThreadReadMock.mockResolvedValue({ data: state });

    const { chatRoomService } = await import("../chat-room.service");
    const result = await chatRoomService.markThreadRead("room-1", "msg-1");

    expect(markChatRoomThreadReadMock).toHaveBeenCalledWith("room-1", "msg-1");
    expect(result).toEqual(state);
  });

  it("markAllUnreadThreadsRead posts mark-all for room", async () => {
    const payload = { markedCount: 3 };
    markChatRoomThreadsReadMock.mockResolvedValue({ data: payload });

    const { chatRoomService } = await import("../chat-room.service");
    const result = await chatRoomService.markAllUnreadThreadsRead("room-1");

    expect(markChatRoomThreadsReadMock).toHaveBeenCalledWith("room-1");
    expect(result).toEqual(payload);
  });
});
