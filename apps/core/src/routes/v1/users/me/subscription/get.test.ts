import { describe, expect, it } from "vitest";

import usersMeRouter from "../index";

describe("users/me subscription routes OpenAPI contract", () => {
  it("exposes subscription routes with expected responses", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const meSubscriptionResponses = doc.paths?.["/subscription"]?.get?.responses;
    const organizationSubscriptionResponses =
      doc.paths?.["/organizations/{id}/subscription"]?.get?.responses;

    expect(meSubscriptionResponses).toBeDefined();
    expect(meSubscriptionResponses).toHaveProperty("200");
    expect(meSubscriptionResponses).toHaveProperty("401");
    expect(meSubscriptionResponses).toHaveProperty("403");
    expect(meSubscriptionResponses).toHaveProperty("500");

    expect(organizationSubscriptionResponses).toBeDefined();
    expect(organizationSubscriptionResponses).toHaveProperty("200");
    expect(organizationSubscriptionResponses).toHaveProperty("401");
    expect(organizationSubscriptionResponses).toHaveProperty("403");
    expect(organizationSubscriptionResponses).toHaveProperty("404");
    expect(organizationSubscriptionResponses).toHaveProperty("500");
  });
});
