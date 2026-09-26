import { describe, expect, it } from "vitest";

import { movePinnedRoomId } from "./pinned-rooms-dnd";

describe("movePinnedRoomId", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves a room down into the slot the target holds", () => {
    expect(movePinnedRoomId(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves a room up into the slot the target holds", () => {
    expect(movePinnedRoomId(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the same array when nothing moves", () => {
    expect(movePinnedRoomId(ids, "b", "b")).toBe(ids);
    expect(movePinnedRoomId(ids, "b", "gone")).toBe(ids);
    expect(movePinnedRoomId(ids, "gone", "b")).toBe(ids);
  });
});
