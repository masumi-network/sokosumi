import { describe, expect, it } from "vitest";

import {
  AVATAR_EXCLUDE_CAP,
  excludeIdsForAvatarRefresh,
  fillAvatarRow,
  nextSeenAvatars,
} from "./avatar-picker-exclusions";

describe("avatar picker exclusions", () => {
  it("sends the accumulated ids until the cap, then wraps around", () => {
    const underCap = Array.from({ length: AVATAR_EXCLUDE_CAP - 1 }, (_, i) =>
      String(i),
    );
    const atCap = [...underCap, "last"];

    expect(excludeIdsForAvatarRefresh(underCap)).toBe(underCap);
    expect(excludeIdsForAvatarRefresh(atCap)).toEqual([]);
  });

  it("replaces seen after a wrap-around request, otherwise appends", () => {
    const [a, b] = [{ id: "a" }, { id: "b" }];
    expect(nextSeenAvatars([a], [b], [])).toEqual([b]);
    expect(nextSeenAvatars([a], [b], ["a"])).toEqual([a, b]);
  });

  it("fills a short row with the most recently seen, never twice", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(fillAvatarRow([d], [a, b, c, d], 3)).toEqual([d, c, b]);
    expect(fillAvatarRow([a, b], [c], 2)).toEqual([a, b]);
  });
});
