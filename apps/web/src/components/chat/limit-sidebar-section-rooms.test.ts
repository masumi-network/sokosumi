import { describe, expect, it } from "vitest";

import { limitSidebarSectionRooms } from "./limit-sidebar-section-rooms";

const ROOMS = ["a", "b", "c", "d", "e", "f", "g", "h"];
const none = () => false;

describe("limitSidebarSectionRooms", () => {
  it("lists the first rooms up to the limit and counts the rest", () => {
    expect(
      limitSidebarSectionRooms(ROOMS, { showAll: false, alwaysShow: none }),
    ).toEqual({ visible: ["a", "b", "c", "d", "e"], hiddenCount: 3 });
  });

  it("keeps a room past the limit in its own place when it must show", () => {
    expect(
      limitSidebarSectionRooms(ROOMS, {
        showAll: false,
        alwaysShow: (room) => room === "g",
      }),
    ).toEqual({ visible: ["a", "b", "c", "d", "e", "g"], hiddenCount: 2 });
  });

  it("does not grow the section for a kept room already inside the limit", () => {
    expect(
      limitSidebarSectionRooms(ROOMS, {
        showAll: false,
        alwaysShow: (room) => room === "b",
      }).visible,
    ).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("lists everything when show all is on, and still counts the hidden", () => {
    expect(
      limitSidebarSectionRooms(ROOMS, { showAll: true, alwaysShow: none }),
    ).toEqual({ visible: ROOMS, hiddenCount: 3 });
  });

  it("needs no toggle when the limit would hide one room or none", () => {
    for (const rooms of [ROOMS.slice(0, 5), ROOMS.slice(0, 6)]) {
      expect(
        limitSidebarSectionRooms(rooms, { showAll: false, alwaysShow: none }),
      ).toEqual({ visible: rooms, hiddenCount: 0 });
    }
  });
});
