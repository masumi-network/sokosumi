import { describe, expect, it } from "vitest";

import { readWorkScopeParam } from "./work-scope";

describe("readWorkScopeParam", () => {
  it("reads the old owned scope as mine", () => {
    expect(readWorkScopeParam("owned")).toBe("mine");
    expect(readWorkScopeParam(" owned ")).toBe("mine");
  });

  it("passes every other value through, trimmed", () => {
    expect(readWorkScopeParam(" mine ")).toBe("mine");
    expect(readWorkScopeParam("workspace")).toBe("workspace");
    expect(readWorkScopeParam("not-a-scope")).toBe("not-a-scope");
  });
});
