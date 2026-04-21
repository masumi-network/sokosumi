import { describe, expect, it } from "vitest";

import usersRouter from "../../index";

describe("users/{id}/credits OpenAPI contract", () => {
  it("documents credits lookup with shared response contract", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users by ID API",
        version: "1.0.0",
      },
    });

    const creditsResponses = doc.paths?.["/{id}/credits"]?.get?.responses;

    expect(creditsResponses).toBeDefined();
    expect(creditsResponses).toHaveProperty("200");
    expect(creditsResponses).toHaveProperty("401");
    expect(creditsResponses).toHaveProperty("403");
    expect(creditsResponses).toHaveProperty("404");
    expect(creditsResponses).toHaveProperty("500");

    const contract = JSON.stringify(creditsResponses?.["200"]);
    expect(contract).toContain("buffer");
    expect(contract).toContain("total");
    expect(contract).toContain("subscription");
  });
});
