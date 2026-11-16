import { describe, expect, it } from "vitest";

import { fillAvatarRow } from "./avatar-picker-exclusions";

describe("avatar picker exclusions", () => {
  it("fills a short row with the most recently seen, never twice", () => {
    const [a, b, c, d] = ["a", "b", "c", "d"].map((id) => ({ id }));
    expect(fillAvatarRow([d], [a, b, c, d], 3)).toEqual([d, c, b]);
    expect(fillAvatarRow([a, b], [c], 2)).toEqual([a, b]);
  });
});
