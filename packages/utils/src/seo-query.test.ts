import { describe, expect, it } from "vitest";

import { normalizeSeoQuery } from "./seo-query.js";

describe("normalizeSeoQuery", () => {
  it("folds width, case and spacing to one key", () => {
    expect(normalizeSeoQuery("  Ｃ++  Guide\tFOO\n")).toBe("c++ guide foo");
  });
});
