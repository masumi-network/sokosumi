import { describe, expect, it } from "vitest";

import {
  AVATAR_EXCLUDE_CAP,
  excludeIdsForAvatarRefresh,
  nextSeenAvatarIds,
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
    expect(nextSeenAvatarIds(["a"], ["b"], [])).toEqual(["b"]);
    expect(nextSeenAvatarIds(["a"], ["b"], ["a"])).toEqual(["a", "b"]);
  });
});
