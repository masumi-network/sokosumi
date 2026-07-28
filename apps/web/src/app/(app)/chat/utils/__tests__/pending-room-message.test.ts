import { afterEach, describe, expect, it } from "vitest";
import {
  clearPendingRoomMessage,
  peekPendingRoomMessage,
  stashPendingRoomMessage,
  takePendingRoomMessage,
} from "../pending-room-message";

describe("pending-room-message", () => {
  afterEach(() => {
    clearPendingRoomMessage("room-1");
  });

  it("stashes, peeks, and clears", () => {
    stashPendingRoomMessage("room-1", "  hello  ");
    expect(peekPendingRoomMessage("room-1")).toBe("hello");
    clearPendingRoomMessage("room-1");
    expect(peekPendingRoomMessage("room-1")).toBeNull();
  });

  it("take clears storage", () => {
    stashPendingRoomMessage("room-1", "hi");
    expect(takePendingRoomMessage("room-1")).toBe("hi");
    expect(takePendingRoomMessage("room-1")).toBeNull();
  });
});
