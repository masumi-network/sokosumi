import { describe, expect, it } from "vitest";

import {
  findNearestCenterId,
  findNearestCenterIdFromElements,
} from "./nearest-center-coworker";

describe("findNearestCenterId", () => {
  it("returns null when there are no candidates", () => {
    expect(findNearestCenterId(100, [])).toBeNull();
  });

  it("picks the candidate whose center is nearest the viewport center", () => {
    expect(
      findNearestCenterId(200, [
        { id: "a", centerX: 50 },
        { id: "b", centerX: 190 },
        { id: "c", centerX: 350 },
      ]),
    ).toBe("b");
  });

  it("keeps the earlier candidate on an exact tie", () => {
    expect(
      findNearestCenterId(100, [
        { id: "left", centerX: 80 },
        { id: "right", centerX: 120 },
      ]),
    ).toBe("left");
  });

  it("selects the sole candidate regardless of distance", () => {
    expect(findNearestCenterId(0, [{ id: "only", centerX: 999 }])).toBe("only");
  });
});

describe("findNearestCenterIdFromElements", () => {
  it("measures scrollport and items to pick the middle coworker", () => {
    const scrollport = document.createElement("div");
    scrollport.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 300,
        top: 0,
        height: 40,
        right: 300,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;

    function itemAt(left: number, width: number): HTMLElement {
      const element = document.createElement("button");
      element.getBoundingClientRect = () =>
        ({
          left,
          width,
          top: 0,
          height: 40,
          right: left + width,
          bottom: 40,
          x: left,
          y: 0,
          toJSON: () => ({}),
        }) as DOMRect;
      return element;
    }

    const items = new Map<string, HTMLElement>([
      ["deckster", itemAt(-40, 80)],
      ["apol", itemAt(110, 80)],
      ["elena", itemAt(260, 80)],
    ]);

    // Viewport center at 150; Apol's center at 150.
    expect(findNearestCenterIdFromElements(scrollport, items)).toBe("apol");
  });
});
