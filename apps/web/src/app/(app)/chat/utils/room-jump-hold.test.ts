import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
  createRoomJumpState,
  type RoomJumpState,
  startRoomJump,
} from "./room-jump-hold";

describe("startRoomJump", () => {
  let state: RoomJumpState;
  let hold: Mock<() => void>;
  let release: Mock<() => void>;
  let inRoom: boolean;

  function start() {
    return startRoomJump(state, {
      isStillSelectedRoom: () => inRoom,
      hold,
      release,
    });
  }

  beforeEach(() => {
    state = createRoomJumpState();
    hold = vi.fn();
    release = vi.fn();
    inRoom = true;
  });

  it("gives back a hold it took", () => {
    const jump = start();

    jump.holdOffBottom();
    jump.releaseHoldOffBottom();

    expect(hold).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it("stops speaking for the reader once a later jump starts", () => {
    const first = start();
    const second = start();

    expect(first.isNewestJump()).toBe(false);
    expect(second.isNewestJump()).toBe(true);
  });

  it("does not release a hold a later jump took", () => {
    const first = start();
    first.holdOffBottom();
    const second = start();
    second.holdOffBottom();

    first.releaseHoldOffBottom();

    // The second jump is still loading its window. Releasing here would let
    // the room re-pin to its newest message and undo the jump the reader is
    // waiting for.
    expect(release).not.toHaveBeenCalled();

    second.releaseHoldOffBottom();
    expect(release).toHaveBeenCalledOnce();
  });

  it("lets the holder release after a later jump that took no hold", () => {
    const first = start();
    first.holdOffBottom();
    // A jump whose message is already on screen highlights it and returns
    // without ever taking the hold.
    start();

    first.releaseHoldOffBottom();

    // Recency would refuse this and leave the room held off the bottom with
    // nobody able to give it back.
    expect(release).toHaveBeenCalledOnce();
    expect(state.holdOwner).toBe(0);
  });

  it("neither takes nor releases for a room the reader has left", () => {
    const jump = start();
    jump.holdOffBottom();
    expect(hold).toHaveBeenCalledOnce();

    inRoom = false;
    jump.releaseHoldOffBottom();

    // The hold belongs to a room nobody is looking at. Releasing now would
    // drop whatever hold the room they moved to is relying on.
    expect(release).not.toHaveBeenCalled();

    const afterTheMove = start();
    afterTheMove.holdOffBottom();
    expect(hold).toHaveBeenCalledOnce();
  });

  it("hands the hold on when the holder is replaced and gives up", () => {
    const first = start();
    first.holdOffBottom();
    const second = start();
    second.holdOffBottom();

    first.releaseHoldOffBottom();
    second.releaseHoldOffBottom();

    // Whoever holds it last is the one that gives it back, so no jump ends
    // with the room still held.
    expect(release).toHaveBeenCalledOnce();
    expect(state.holdOwner).toBe(0);
  });
});
