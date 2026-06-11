import { describe, expect, it } from "vitest";

import usersRouter from "../../index";

describe("users/me subscription routes OpenAPI contract", () => {
  it("exposes only a lean subscription route without a credits breakdown", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    // Subscription credit details are served by the /credits endpoints (see
    // #2518). The lean /{id}/subscription route only resolves the active
    // subscription row and must not duplicate the credits breakdown.
    const meSubscriptionResponses =
      doc.paths?.["/{id}/subscription"]?.get?.responses;
    const organizationSubscriptionResponses =
      doc.paths?.["/{id}/organizations/{organizationId}/subscription"]?.get
        ?.responses;

    expect(meSubscriptionResponses).toBeDefined();
    expect(organizationSubscriptionResponses).toBeUndefined();

    const activeSubscriptionResponseSchema =
      doc.components?.schemas?.ActiveSubscriptionResponse;

    expect(activeSubscriptionResponseSchema).toBeDefined();
    expect(JSON.stringify(activeSubscriptionResponseSchema)).not.toContain(
      '"credits"',
    );
  });
});
