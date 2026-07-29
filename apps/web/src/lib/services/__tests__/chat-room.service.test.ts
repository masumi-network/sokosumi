import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getChatRoomsMock = vi.fn();

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
    getChatRoomsMock.mockResolvedValue({
      data: [room("dm-1")],
      meta: {
        pagination: {
          cursor: null,
          limit: 100,
          total: 1,
          nextCursor: null,
        },
      },
    });

    const { chatRoomService } = await import("../chat-room.service");
    await chatRoomService.listRooms("direct");

    expect(getChatRoomsMock).toHaveBeenCalledWith({
      limit: 100,
      status: "active",
      kind: "direct",
    });
  });
});
