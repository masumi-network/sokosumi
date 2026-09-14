import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_MESSAGE_LIST_ROOM,
  CHAT_MESSAGE_LIST_THREAD,
} from "@/app/chat/chat-message-list";
import {
  performRoomSearchJump,
  waitForSearchJumpPaint,
  waitForThreadJumpPaint,
} from "@/app/chat/utils/room-search-jump";
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
    highlightInThread: vi.fn(() => false),
    afterThreadRender: vi.fn(async () => {}),
    afterRoomRender: vi.fn(async () => {}),
    loadAroundInRoom: vi.fn(async () => false),
    findLoadedParent: vi.fn(() => undefined),
    loadParent: vi.fn(async () => null),
    openThread: vi.fn(async () => true),
    highlightInRoom: vi.fn(() => false),
    loadAroundInThread: vi.fn(async () => false),
    ...overrides,
  };
}

describe("performRoomSearchJump", () => {
  it("highlights a top-level hit already in the DOM", async () => {
    const hit = message();
    // A top-level hit is answered by the transcript alone. An open thread
    // renders its parent as well, and taking that copy would end the jump
    // with the transcript never moved.
    const jump = deps({ highlightInRoom: vi.fn(() => true) });

    await performRoomSearchJump(hit, jump);

    expect(jump.holdOffBottom).toHaveBeenCalled();
    expect(jump.highlightInRoom).toHaveBeenCalledWith(hit.id);
    expect(jump.highlightInThread).not.toHaveBeenCalled();
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
      highlightInRoom: vi
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
    expect(jump.highlightInRoom).toHaveBeenLastCalledWith(hit.id);
    expect(jump.releaseHoldOffBottom).not.toHaveBeenCalled();
  });

  it("loads around a top-level hit that is not rendered, then highlights", async () => {
    const hit = message();
    const jump = deps({
      highlightInRoom: vi
        .fn(() => false)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
      loadAroundInRoom: vi.fn(async () => true),
    });

    await performRoomSearchJump(hit, jump);

    expect(jump.loadAroundInRoom).toHaveBeenCalledWith(hit.id);
    expect(jump.highlightInRoom).toHaveBeenLastCalledWith(hit.id);
    expect(jump.afterRoomRender).toHaveBeenCalled();
  });

  it("opens the thread for a reply whose parent is loaded, then highlights", async () => {
    const parent = message({ id: "550e8400-e29b-41d4-a716-446655440010" });
    const hit = message({
      id: "550e8400-e29b-41d4-a716-446655440011",
      parentMessageId: parent.id,
    });
    const jump = deps({
      highlightInThread: vi.fn(() => true),
      findLoadedParent: vi.fn(() => parent),
    });

    await performRoomSearchJump(hit, jump);

    expect(jump.openThread).toHaveBeenCalledWith(parent);
    expect(jump.loadParent).not.toHaveBeenCalled();
    expect(jump.highlightInThread).toHaveBeenCalledWith(hit.id);
    expect(jump.releaseHoldOffBottom).toHaveBeenCalled();
    expect(jump.loadAroundInThread).not.toHaveBeenCalled();
  });

  /**
   * A reply lives in a thread, but the thread hangs off a message in the room
   * transcript. Landing in the thread alone leaves the transcript behind it
   * wherever it was, which is usually the newest message: the reader is shown
   * a reply with no sight of what it is a reply to.
   *
   * Marked as well as scrolled. The two marks sit in different lists
   * (`room-message-highlight.ts` keeps one per list), so the parent's mark and
   * the reply's stand together.
   */
  it("marks the room transcript parent as well as opening the thread", async () => {
    const parent = message({ id: "550e8400-e29b-41d4-a716-446655440010" });
    const hit = message({
      id: "550e8400-e29b-41d4-a716-446655440011",
      parentMessageId: parent.id,
    });
    const order: string[] = [];
    const jump = deps({
      findLoadedParent: vi.fn(() => parent),
      openThread: vi.fn(async () => {
        order.push("openThread");
        return true;
      }),
      highlightInRoom: vi.fn((id: string) => {
        order.push(`highlightInRoom:${id}`);
        return true;
      }),
      highlightInThread: vi.fn((id: string) => {
        order.push(`highlightInThread:${id}`);
        return true;
      }),
    });

    await performRoomSearchJump(hit, jump);

    expect(jump.highlightInRoom).toHaveBeenCalledWith(parent.id);
    // Last of the three. `openThread` resolves on the state that opens the
    // panel, not on the paint, and opening it narrows the room column: a
    // transcript scrolled before that reflow drifts as the rows re-wrap.
    expect(order).toEqual([
      "openThread",
      `highlightInThread:${hit.id}`,
      `highlightInRoom:${parent.id}`,
    ]);
  });

  /**
   * The parent can sit further back than the loaded ranges of the transcript.
   * A window around it would be one more fetch to move a transcript the
   * thread panel is covering, so the transcript is left where it is.
   *
   * Named for the room window rather than for the missing parent, because the
   * missing parent is what `highlightInRoom` swallows and this test cannot see:
   * what it does pin is that no fallback load was added behind it.
   */
  it("loads no room window for a thread jump", async () => {
    const parent = message({ id: "550e8400-e29b-41d4-a716-446655440010" });
    const hit = message({
      id: "550e8400-e29b-41d4-a716-446655440011",
      parentMessageId: parent.id,
    });
    const jump = deps({
      findLoadedParent: vi.fn(() => parent),
      highlightInThread: vi.fn(() => true),
    });

    await performRoomSearchJump(hit, jump);

    expect(jump.loadAroundInRoom).not.toHaveBeenCalled();
    expect(jump.openThread).toHaveBeenCalledWith(parent);
    expect(jump.highlightInThread).toHaveBeenCalledWith(hit.id);
    expect(jump.releaseHoldOffBottom).toHaveBeenCalled();
  });

  it("fetches a missing parent, opens the thread, then loads around an old reply", async () => {
    const parent = message({ id: "550e8400-e29b-41d4-a716-446655440010" });
    const hit = message({
      id: "550e8400-e29b-41d4-a716-446655440011",
      parentMessageId: parent.id,
    });
    const jump = deps({
      highlightInThread: vi
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
    expect(jump.highlightInThread).toHaveBeenLastCalledWith(hit.id);
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

/**
 * Both lists render a thread's parent, and the room jump and the thread jump
 * each wait for their own. A wait answered by the other list's copy returns
 * before the list the caller is about to land on has painted, and the jump
 * lands on nothing.
 */
describe("the jump paint waits", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  function countFrames(): () => number {
    let frames = 0;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames += 1;
      queueMicrotask(() => {
        callback(0);
      });
      return frames;
    });
    return () => frames;
  }

  function listWithRow(list: string, messageId: string): void {
    const container = document.createElement("div");
    container.setAttribute("data-chat-message-list", list);
    const row = document.createElement("article");
    row.setAttribute("data-message-id", messageId);
    container.append(row);
    document.body.append(container);
  }

  it("waits out its frames when only the thread holds the message", async () => {
    listWithRow(CHAT_MESSAGE_LIST_THREAD, "msg-1");
    const frames = countFrames();

    await waitForSearchJumpPaint("msg-1");

    expect(frames()).toBe(3);
  });

  it("returns at once when the transcript holds the message", async () => {
    listWithRow(CHAT_MESSAGE_LIST_ROOM, "msg-1");
    const frames = countFrames();

    await waitForSearchJumpPaint("msg-1");

    expect(frames()).toBe(0);
  });

  it("waits out its frames when only the transcript holds the message", async () => {
    listWithRow(CHAT_MESSAGE_LIST_ROOM, "msg-1");
    const frames = countFrames();

    await waitForThreadJumpPaint("msg-1");

    expect(frames()).toBe(3);
  });

  it("returns at once when the thread holds the message", async () => {
    listWithRow(CHAT_MESSAGE_LIST_THREAD, "msg-1");
    const frames = countFrames();

    await waitForThreadJumpPaint("msg-1");

    expect(frames()).toBe(0);
  });
});
