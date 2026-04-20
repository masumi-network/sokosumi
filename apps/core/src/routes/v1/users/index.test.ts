import { describe, expect, it } from "vitest";

import usersRouter from "./index";

describe("users routes OpenAPI contract", () => {
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
