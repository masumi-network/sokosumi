import { describe, expect, it } from "vitest";

import usersRouter from "../../index";

describe("users/me subscription routes OpenAPI contract", () => {
  it("exposes subscription routes", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const meSubscriptionResponses =
      doc.paths?.["/{id}/subscription"]?.get?.responses;
    const organizationSubscriptionResponses =
      doc.paths?.["/{id}/organizations/{organizationId}/subscription"]?.get
        ?.responses;

    expect(meSubscriptionResponses).toBeDefined();
    expect(meSubscriptionResponses).toHaveProperty("200");
    expect(organizationSubscriptionResponses).toBeDefined();
    expect(organizationSubscriptionResponses).toHaveProperty("200");
  });
});
