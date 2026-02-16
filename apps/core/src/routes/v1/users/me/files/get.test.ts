import { describe, expect, it } from "vitest";

import usersMeRouter from "../index";

describe("users/me files routes OpenAPI contract", () => {
  it("does not expose query pagination parameters on GET /files", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const operation = doc.paths?.["/files"]?.get;
    const parameters = operation?.parameters ?? [];
    const queryParameters = parameters.filter((parameter) => {
      if (!parameter || typeof parameter !== "object") {
        return false;
      }

      return "in" in parameter && parameter.in === "query";
    });

    expect(queryParameters).toHaveLength(0);
  });
});
