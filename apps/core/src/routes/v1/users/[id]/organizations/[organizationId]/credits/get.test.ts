import { describe, expect, it } from "vitest";

import usersRouter from "../../../../index";

describe("users/{id}/organizations/{organizationId}/credits OpenAPI contract", () => {
  it("documents organization credits with nested subscription, buffer, and total payload", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    const organizationCreditsResponses =
      doc.paths?.["/{id}/organizations/{organizationId}/credits"]?.get
        ?.responses;

    expect(organizationCreditsResponses).toBeDefined();
    expect(organizationCreditsResponses).toHaveProperty("200");
    expect(organizationCreditsResponses).toHaveProperty("401");
    expect(organizationCreditsResponses).toHaveProperty("403");
    expect(organizationCreditsResponses).toHaveProperty("404");
    expect(organizationCreditsResponses).toHaveProperty("500");

    const organizationCreditsContract = JSON.stringify(
      organizationCreditsResponses?.["200"],
    );

    expect(organizationCreditsContract).toContain("extra");
    expect(organizationCreditsContract).toContain("buffer");
    expect(organizationCreditsContract).toContain("total");
    expect(organizationCreditsContract).toContain("subscription");
  });
});
