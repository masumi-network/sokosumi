import { describe, expect, it } from "vitest";

import usersRouter from "../../index";

describe("users/me files routes OpenAPI contract", () => {
  it("documents GET /{id}/files without query pagination", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const filesPath = doc.paths?.["/{id}/files"];
    const operation = filesPath?.get;
    const parameters = operation?.parameters ?? [];
    const queryParameters = parameters.filter((parameter) => {
      if (!parameter || typeof parameter !== "object") {
        return false;
      }

      return "in" in parameter && parameter.in === "query";
    });

    expect(filesPath?.get).toBeDefined();
    expect(filesPath?.post).toBeDefined();
    expect(doc.paths?.["/files"]).toBeUndefined();
    expect(queryParameters).toHaveLength(0);
  });
});
