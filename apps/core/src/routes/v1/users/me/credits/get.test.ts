import { describe, expect, it } from "vitest";

import usersMeRouter from "../index";

describe("users/me credits routes OpenAPI contract", () => {
  it("exposes credits routes with nested subscription and buffer payload", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const meCreditsResponses = doc.paths?.["/credits"]?.get?.responses;
    const organizationCreditsResponses =
      doc.paths?.["/organizations/{id}/credits"]?.get?.responses;

    expect(meCreditsResponses).toBeDefined();
    expect(meCreditsResponses).toHaveProperty("200");
    expect(meCreditsResponses).toHaveProperty("401");
    expect(meCreditsResponses).toHaveProperty("403");
    expect(meCreditsResponses).toHaveProperty("500");

    expect(organizationCreditsResponses).toBeDefined();
    expect(organizationCreditsResponses).toHaveProperty("200");
    expect(organizationCreditsResponses).toHaveProperty("401");
    expect(organizationCreditsResponses).toHaveProperty("403");
    expect(organizationCreditsResponses).toHaveProperty("404");
    expect(organizationCreditsResponses).toHaveProperty("500");

    const meCreditsContract = JSON.stringify(meCreditsResponses?.["200"]);
    const organizationCreditsContract = JSON.stringify(
      organizationCreditsResponses?.["200"],
    );

    expect(meCreditsContract).toContain("buffer");
    expect(meCreditsContract).toContain("subscription");
    expect(organizationCreditsContract).toContain("buffer");
    expect(organizationCreditsContract).toContain("subscription");
  });
});
