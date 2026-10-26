import { describe, expect, it } from "vitest";

import { moveIdToSlot } from "./move-id";

describe("moveIdToSlot", () => {
  const ids = ["a", "b", "c", "d"];

  it("moves an ID down into the slot the target holds", () => {
    expect(moveIdToSlot(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an ID up into the slot the target holds", () => {
    expect(moveIdToSlot(ids, "d", "b")).toEqual(["a", "d", "b", "c"]);
  });

  it("returns the same array when nothing moves", () => {
    expect(moveIdToSlot(ids, "b", "b")).toBe(ids);
    expect(moveIdToSlot(ids, "b", "gone")).toBe(ids);
    expect(moveIdToSlot(ids, "gone", "b")).toBe(ids);
  });
});
