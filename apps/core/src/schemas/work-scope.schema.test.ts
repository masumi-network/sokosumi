import { describe, expect, it } from "vitest";

import { workScopeQuerySchema } from "./work-scope.schema";

describe("workScopeQuerySchema", () => {
  const schema = workScopeQuerySchema({
    defaultScope: "mine",
    description: "Which work to list.",
  });

  it("accepts mine and workspace as they are", () => {
    expect(schema.parse("mine")).toBe("mine");
    expect(schema.parse("workspace")).toBe("workspace");
  });

  it("reads the deprecated owned alias as mine", () => {
    expect(schema.parse("owned")).toBe("mine");
  });

  it("falls back to the default scope", () => {
    expect(schema.parse(undefined)).toBe("mine");
    expect(
      workScopeQuerySchema({
        defaultScope: "workspace",
        description: "Which work to show.",
      }).parse(undefined),
    ).toBe("workspace");
  });

  it("rejects anything else", () => {
    expect(schema.safeParse("everyone").success).toBe(false);
  });
});
