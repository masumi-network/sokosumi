import { describe, expect, it } from "vitest";

import catalogRouter from "./index";

describe("catalog routes OpenAPI contract", () => {
  const doc = catalogRouter.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Catalog API",
      version: "1.0.0",
    },
  });

  it("exposes a single GET / endpoint", () => {
    const paths = Object.keys(doc.paths ?? {});
    expect(paths).toEqual(["/"]);
  });

  it("documents the coworkerScope query parameter and validation failure", () => {
    const operation = doc.paths?.["/"]?.get;
    const parameterNames = (operation?.parameters ?? []).map((parameter) =>
      "name" in parameter ? parameter.name : null,
    );

    expect(parameterNames).toContain("coworkerScope");
    expect(operation?.responses).toHaveProperty("422");
  });

  it("documents the Catalog schema with agents and coworkers", () => {
    const components = doc.components?.schemas as
      | Record<string, { properties?: Record<string, unknown> }>
      | undefined;

    expect(components?.Catalog?.properties?.agents).toBeDefined();
    expect(components?.Catalog?.properties?.coworkers).toBeDefined();
  });
});
