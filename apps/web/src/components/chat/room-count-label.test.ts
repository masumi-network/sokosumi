import { describe, expect, it } from "vitest";
import {
  ROOM_COUNT_CAP,
  roomCountLabel,
} from "@/components/chat/room-count-label";

describe("roomCountLabel", () => {
  it("prints a count under the cap as it is", () => {
    expect(roomCountLabel(1)).toBe("1");
    expect(roomCountLabel(42)).toBe("42");
  });

  it("prints the cap itself without a plus", () => {
    expect(roomCountLabel(ROOM_COUNT_CAP)).toBe("99");
  });

  it("caps anything above it", () => {
    expect(roomCountLabel(ROOM_COUNT_CAP + 1)).toBe("99+");
    expect(roomCountLabel(4000)).toBe("99+");
  });
});
