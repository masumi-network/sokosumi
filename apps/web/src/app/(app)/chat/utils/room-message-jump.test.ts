import { describe, expect, it, vi } from "vitest";

import { performRoomMessageJump } from "@/app/chat/utils/room-message-jump";

function deps(
  overrides: Partial<Parameters<typeof performRoomMessageJump>[1]> = {},
) {
  return {
    highlight: vi.fn(() => false),
    holdOffBottom: vi.fn(),
    releaseHoldOffBottom: vi.fn(),
    loadAround: vi.fn(async () => true),
    afterRender: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("performRoomMessageJump", () => {
  it("highlights a message that is already on screen without loading", async () => {
    const d = deps({ highlight: vi.fn(() => true) });

    await performRoomMessageJump("msg-1", d);

    expect(d.highlight).toHaveBeenCalledExactlyOnceWith("msg-1");
    expect(d.loadAround).not.toHaveBeenCalled();
    expect(d.holdOffBottom).not.toHaveBeenCalled();
  });

  it("loads the window around a message it cannot see, then highlights it", async () => {
    const d = deps();

    await performRoomMessageJump("msg-1", d);

    expect(d.holdOffBottom).toHaveBeenCalledOnce();
    expect(d.loadAround).toHaveBeenCalledExactlyOnceWith("msg-1");
    expect(d.afterRender).toHaveBeenCalledExactlyOnceWith("msg-1");
    expect(d.highlight).toHaveBeenCalledTimes(2);
    expect(d.releaseHoldOffBottom).toHaveBeenCalledOnce();
  });

  it("waits for the message to paint before highlighting it", async () => {
    const order: string[] = [];
    const d = deps({
      afterRender: vi.fn(async () => {
        order.push("afterRender");
      }),
      highlight: vi.fn(() => {
        order.push("highlight");
        return false;
      }),
    });

    await performRoomMessageJump("msg-1", d);

    expect(order).toEqual(["highlight", "afterRender", "highlight"]);
  });

  it("releases the hold when the window cannot be loaded", async () => {
    const d = deps({ loadAround: vi.fn(async () => false) });

    await performRoomMessageJump("msg-1", d);

    expect(d.releaseHoldOffBottom).toHaveBeenCalledOnce();
    expect(d.afterRender).not.toHaveBeenCalled();
  });

  it("releases the hold when loading throws", async () => {
    const d = deps({
      loadAround: vi.fn(async () => {
        throw new Error("network");
      }),
    });

    await expect(performRoomMessageJump("msg-1", d)).rejects.toThrow("network");
    expect(d.releaseHoldOffBottom).toHaveBeenCalledOnce();
  });
});
