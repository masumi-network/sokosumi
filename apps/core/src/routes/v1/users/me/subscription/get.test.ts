import { describe, expect, it } from "vitest";

import usersMeRouter from "../index";

describe("users/me subscription routes OpenAPI contract", () => {
  it("does not expose subscription routes", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const meSubscriptionResponses =
      doc.paths?.["/subscription"]?.get?.responses;
    const organizationSubscriptionResponses =
      doc.paths?.["/organizations/{id}/subscription"]?.get?.responses;

    expect(meSubscriptionResponses).toBeUndefined();
    expect(organizationSubscriptionResponses).toBeUndefined();
  });
});
