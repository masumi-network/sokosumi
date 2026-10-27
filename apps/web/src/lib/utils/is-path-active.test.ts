import { describe, expect, it } from "vitest";

import { isPathActive } from "./is-path-active";

describe("isPathActive", () => {
  it("holds on the route itself and on any page under it", () => {
    expect(isPathActive("/tasks", "/tasks")).toBe(true);
    expect(isPathActive("/tasks/t-1/edit", "/tasks")).toBe(true);
  });

  it("does not hold on a sibling route that only shares a prefix", () => {
    expect(isPathActive("/tasks-archive", "/tasks")).toBe(false);
    expect(isPathActive("/", "/tasks")).toBe(false);
  });
});
