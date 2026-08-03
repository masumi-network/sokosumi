import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getChatRoomsMock = vi.fn();
const getDiscoverableChatRoomsMock = vi.fn();
const archiveChatRoomMock = vi.fn();
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
    archiveChatRoom: (...args: unknown[]) => archiveChatRoomMock(...args),
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

function emptyPage(data: ReturnType<typeof room>[]) {
  return {
    data,
    meta: {
      pagination: {
        cursor: null,
        limit: 100,
        total: data.length,
        nextCursor: null,
      },
    },
  };
}

describe("chatRoomService.listRooms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("walks nextCursor until exhausted", async () => {
    getChatRoomsMock
      .mockResolvedValueOnce({
        data: [room("room-1"), room("room-2")],
        meta: {
          pagination: {
            cursor: null,
            limit: 100,
            total: 3,
            nextCursor: "room-2",
          },
        },
      })
      .mockResolvedValueOnce({
        data: [room("room-3")],
        meta: {
          pagination: {
            cursor: "room-2",
            limit: 100,
            total: 3,
            nextCursor: null,
          },
        },
      });

    const { chatRoomService } = await import("../chat-room.service");
    const rooms = await chatRoomService.listRooms();

    expect(rooms.map((item) => item.id)).toEqual([
      "room-1",
      "room-2",
      "room-3",
    ]);
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
    getChatRoomsMock.mockResolvedValue(emptyPage([room("dm-1")]));

    const { chatRoomService } = await import("../chat-room.service");
    await chatRoomService.listRooms("direct");

    expect(getChatRoomsMock).toHaveBeenCalledWith({
      limit: 100,
      status: "active",
      kind: "direct",
    });
  });

  it("passes archived status when listing archived rooms", async () => {
    getChatRoomsMock.mockResolvedValue(emptyPage([room("archived-1")]));

    const { chatRoomService } = await import("../chat-room.service");
    const rooms = await chatRoomService.listRooms("channel", "archived");

    expect(rooms.map((item) => item.id)).toEqual(["archived-1"]);
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

  it("requests archived organization channels", async () => {
    getChatRoomsMock.mockResolvedValue(emptyPage([room("archived-1")]));

    const { chatRoomService } = await import("../chat-room.service");
    const rooms = await chatRoomService.listArchivedRooms();

    expect(rooms.map((item) => item.id)).toEqual(["archived-1"]);
    expect(getChatRoomsMock).toHaveBeenCalledWith({
      limit: 100,
      status: "archived",
      kind: "channel",
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
});
