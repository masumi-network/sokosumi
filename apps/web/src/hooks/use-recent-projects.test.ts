import { describe, expect, it } from "vitest";

import { appendProjectVisit } from "./use-recent-projects";

describe("appendProjectVisit", () => {
  it("puts the newest visit first", () => {
    expect(appendProjectVisit(["a", "b"], "c")).toEqual(["c", "a", "b"]);
  });

  it("moves a revisited project back to the front instead of repeating it", () => {
    expect(appendProjectVisit(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
  });

  it("drops the oldest visit past the cap", () => {
    expect(appendProjectVisit(["a", "b", "c"], "d", 3)).toEqual([
      "d",
      "a",
      "b",
    ]);
  });

  it("starts a log from an empty one", () => {
    expect(appendProjectVisit([], "a")).toEqual(["a"]);
  });
});
