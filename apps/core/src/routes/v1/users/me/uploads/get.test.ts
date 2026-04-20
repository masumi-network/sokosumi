import { describe, expect, it } from "vitest";

import usersRouter from "../../index";

describe("users/me uploads routes OpenAPI contract", () => {
  it("documents GET /uploads without query pagination and removes legacy /files paths", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const uploadsPath = doc.paths?.["/me/uploads"];
    const operation = uploadsPath?.get;
    const parameters = operation?.parameters ?? [];
    const queryParameters = parameters.filter((parameter) => {
      if (!parameter || typeof parameter !== "object") {
        return false;
      }

      return "in" in parameter && parameter.in === "query";
    });

    expect(uploadsPath?.get).toBeDefined();
    expect(uploadsPath?.post).toBeDefined();
    expect(doc.paths?.["/files"]).toBeUndefined();
    expect(queryParameters).toHaveLength(0);
  });
});
