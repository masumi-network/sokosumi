import { describe, expect, it } from "vitest";

import usersRouter from "./index";

describe("users routes OpenAPI contract", () => {
  it("mounts the registered lookup at /registered without a duplicated segment", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/registered"]?.get).toBeDefined();
    expect(doc.paths?.["/registered/registered"]?.get).toBeUndefined();
  });

  it("returns 404 for /{id} routes when the target user does not exist", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/{id}/files"]?.post?.responses).toHaveProperty("404");
    expect(doc.paths?.["/{id}/files"]?.get?.responses).toHaveProperty("404");
    expect(doc.paths?.["/{id}/preferences"]?.get?.responses).toHaveProperty(
      "404",
    );
    expect(doc.paths?.["/{id}/organizations"]?.get?.responses).toHaveProperty(
      "404",
    );
  });

  it("does not expose a bare organization-by-id details endpoint (only list and org credits)", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/{id}/organizations"]?.get).toBeDefined();
    expect(
      doc.paths?.["/{id}/organizations/{organizationId}"]?.get,
    ).toBeUndefined();
    expect(
      doc.paths?.["/{id}/organizations/{organizationId}/credits"]?.get,
    ).toBeDefined();
  });
});
