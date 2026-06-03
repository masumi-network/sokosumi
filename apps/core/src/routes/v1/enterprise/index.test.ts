import { describe, expect, it } from "vitest";

import enterpriseRouter from "./index";

describe("enterprise admin routes OpenAPI contract", () => {
  const doc = enterpriseRouter.getOpenAPI31Document({
    openapi: "3.1.0",
    info: {
      title: "Enterprise Admin API",
      version: "1.0.0",
    },
  });

  it("mounts contract admin CRUD and lifecycle under /contracts", () => {
    const paths = Object.keys(doc.paths ?? {});

    expect(paths).toContain("/contracts");
    expect(paths).toContain("/contracts/{id}");
    expect(paths).toContain("/contracts/{id}/activate");
    expect(paths).toContain("/contracts/{id}/cancel");
    expect(paths).toContain("/contracts/{id}/periods/preview");
    expect(doc.paths?.["/contracts"]?.post).toBeDefined();
    expect(doc.paths?.["/contracts"]?.get).toBeDefined();
    expect(doc.paths?.["/contracts/{id}"]?.get).toBeDefined();
    expect(doc.paths?.["/contracts/{id}"]?.patch).toBeDefined();
    expect(doc.paths?.["/contracts/{id}/activate"]?.post).toBeDefined();
    expect(doc.paths?.["/contracts/{id}/cancel"]?.post).toBeDefined();
    expect(doc.paths?.["/contracts/{id}/periods/preview"]?.get).toBeDefined();
  });
});
