import { describe, expect, it } from "vitest";

import categoriesRouter from "./index";

describe("categories routes OpenAPI contract", () => {
  it("documents that the categories endpoint returns persisted categories only", () => {
    const doc = categoriesRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Categories API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/"]?.get?.description).toContain("persisted");
    expect(doc.paths?.["/"]?.get?.description).not.toContain("uncategorized");
  });
});
