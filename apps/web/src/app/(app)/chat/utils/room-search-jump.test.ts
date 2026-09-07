import { describe, expect, it, vi } from "vitest";
import { performRoomSearchJump } from "@/app/chat/utils/room-search-jump";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

function message(overrides: Partial<ChatRoomMessage> = {}): ChatRoomMessage {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    roomId: "550e8400-e29b-41d4-a716-446655440000",
    parentMessageId: null,
    content: "Hello",
    createdAt: "2026-08-01T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    metadata: null,
    replyCount: 0,
    sender: {
      type: "user",
      user: {
        id: "user_1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
      },
    },
    reactions: [],
    ...overrides,
  } as ChatRoomMessage;
}

function deps(overrides: Partial<Parameters<typeof performRoomSearchJump>[1]>) {
  return {
    holdOffBottom: vi.fn(),
    releaseHoldOffBottom: vi.fn(),
    highlight: vi.fn(() => false),
    afterRender: vi.fn(async () => {}),
    loadAroundInRoom: vi.fn(async () => false),
    findLoadedParent: vi.fn(() => undefined),
    loadParent: vi.fn(async () => null),
    openThread: vi.fn(async () => true),
    loadAroundInThread: vi.fn(async () => false),
    ...overrides,
  };
}

describe("performRoomSearchJump", () => {
  it("highlights a top-level hit already in the DOM", async () => {
    const hit = message();
    const jump = deps({ highlight: vi.fn(() => true) });

    await performRoomSearchJump(hit, jump);

    expect(jump.holdOffBottom).toHaveBeenCalled();
    expect(jump.highlight).toHaveBeenCalledWith(hit.id);
    expect(jump.releaseHoldOffBottom).toHaveBeenCalled();
    expect(jump.loadAroundInRoom).not.toHaveBeenCalled();
  });

  it("holds the live edge off before loading an around window", async () => {
    const hit = message();
    const order: string[] = [];
    const jump = deps({
      holdOffBottom: vi.fn(() => {
        order.push("hold");
      }),
      highlight: vi
        .fn(() => false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
      loadAroundInRoom: vi.fn(async () => {
        order.push("around");
        return true;
      }),
    });

    await performRoomSearchJump(hit, jump);

    expect(order).toEqual(["hold", "around"]);
    expect(jump.highlight).toHaveBeenLastCalledWith(hit.id);
    expect(jump.releaseHoldOffBottom).not.toHaveBeenCalled();
  });

  it("loads around a top-level hit that is not rendered, then highlights", async () => {
    const hit = message();
    const jump = deps({
      highlight: vi
        .fn(() => false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
      loadAroundInRoom: vi.fn(async () => true),
    });

    await performRoomSearchJump(hit, jump);

    expect(jump.loadAroundInRoom).toHaveBeenCalledWith(hit.id);
    expect(jump.highlight).toHaveBeenLastCalledWith(hit.id);
    expect(jump.afterRender).toHaveBeenCalled();
  });

  it("opens the thread for a reply whose parent is loaded, then highlights", async () => {
    const parent = message({ id: "550e8400-e29b-41d4-a716-446655440010" });
    const hit = message({
      id: "550e8400-e29b-41d4-a716-446655440011",
      parentMessageId: parent.id,
    });
    const jump = deps({
      highlight: vi.fn(() => true),
      findLoadedParent: vi.fn(() => parent),
    });

    await performRoomSearchJump(hit, jump);

    expect(jump.openThread).toHaveBeenCalledWith(parent);
    expect(jump.loadParent).not.toHaveBeenCalled();
    expect(jump.highlight).toHaveBeenCalledWith(hit.id);
    expect(jump.releaseHoldOffBottom).toHaveBeenCalled();
    expect(jump.loadAroundInThread).not.toHaveBeenCalled();
  });

  it("fetches a missing parent, opens the thread, then loads around an old reply", async () => {
    const parent = message({ id: "550e8400-e29b-41d4-a716-446655440010" });
    const hit = message({
      id: "550e8400-e29b-41d4-a716-446655440011",
      parentMessageId: parent.id,
    });
    const jump = deps({
      highlight: vi
        .fn(() => false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
      loadParent: vi.fn(async () => parent),
      loadAroundInThread: vi.fn(async () => true),
    });

    await performRoomSearchJump(hit, jump);

    expect(jump.loadParent).toHaveBeenCalledWith(parent.id);
    expect(jump.openThread).toHaveBeenCalledWith(parent);
    expect(jump.loadAroundInThread).toHaveBeenCalledWith(parent.id, hit.id);
    expect(jump.highlight).toHaveBeenLastCalledWith(hit.id);
    expect(jump.releaseHoldOffBottom).not.toHaveBeenCalled();
  });
  it("drops the hold when the parent cannot be loaded", async () => {
    const hit = message({ id: "reply-1", parentMessageId: "parent-1" });
    const jump = deps({
      findLoadedParent: vi.fn(() => undefined),
      loadParent: vi.fn(async () => null),
    });

    await performRoomSearchJump(hit, jump);

    // A notification for a reply whose parent has since been deleted lands
    // here. Nothing opened, so a held room would stop following new messages
    // and the reader could not re-arm it by scrolling.
    expect(jump.openThread).not.toHaveBeenCalled();
    expect(jump.releaseHoldOffBottom).toHaveBeenCalledOnce();
  });

  it("drops the hold when the thread window cannot be loaded", async () => {
    const parent = message({ id: "parent-1" });
    const hit = message({ id: "reply-1", parentMessageId: parent.id });
    const jump = deps({
      findLoadedParent: vi.fn(() => parent),
      loadAroundInThread: vi.fn(async () => false),
    });

    await performRoomSearchJump(hit, jump);

    expect(jump.releaseHoldOffBottom).toHaveBeenCalledOnce();
  });

  it("drops the hold when the room window cannot be loaded", async () => {
    const hit = message();
    const jump = deps({
      highlight: vi.fn(() => false),
      loadAroundInRoom: vi.fn(async () => false),
    });

    await performRoomSearchJump(hit, jump);

    expect(jump.releaseHoldOffBottom).toHaveBeenCalledOnce();
  });
  it("drops the hold when a lookup rejects instead of failing", async () => {
    const hit = message();
    const jump = deps({
      loadAroundInRoom: vi.fn(async () => {
        throw new Error("offline");
      }),
    });

    // A rejection is a dropped connection, not a refusal: these actions
    // report a server-side error by returning one. The caller on the
    // notification path does not surface what it catches, so a hold left on
    // here would strand the room off the bottom with nothing said.
    await expect(performRoomSearchJump(hit, jump)).rejects.toThrow("offline");

    expect(jump.releaseHoldOffBottom).toHaveBeenCalledOnce();
  });
});
