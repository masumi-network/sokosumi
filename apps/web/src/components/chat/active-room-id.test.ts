import { describe, expect, it } from "vitest";

import { getActiveRoomIdFromPathname } from "./active-room-id";

describe("getActiveRoomIdFromPathname", () => {
  it("reads the room id from a chat room path", () => {
    expect(getActiveRoomIdFromPathname("/chat/rooms/room-1")).toBe("room-1");
  });

  it("ignores anything after the room id", () => {
    expect(getActiveRoomIdFromPathname("/chat/rooms/room-1/threads/t-9")).toBe(
      "room-1",
    );
  });

  it("returns null on the chat index, where no room is open", () => {
    expect(getActiveRoomIdFromPathname("/chat")).toBeNull();
  });

  it("returns null for a path outside chat", () => {
    expect(getActiveRoomIdFromPathname("/tasks/task-1")).toBeNull();
  });

  it("returns null when the room segment is empty", () => {
    expect(getActiveRoomIdFromPathname("/chat/rooms/")).toBeNull();
  });

  it("returns null when there is no pathname yet", () => {
    expect(getActiveRoomIdFromPathname(null)).toBeNull();
  });
});
