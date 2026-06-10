import { describe, expect, it } from "vitest";

import usersRouter from "../../index";

describe("users/{id}/subscription OpenAPI contract", () => {
  it("documents subscription lookup", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    const subscriptionResponses =
      doc.paths?.["/{id}/subscription"]?.get?.responses;

    expect(subscriptionResponses).toBeDefined();
    expect(subscriptionResponses).toHaveProperty("200");
    expect(JSON.stringify(subscriptionResponses?.["200"])).toContain(
      "subscription",
    );
  });
});

describe("users/{id}/organizations/{organizationId}/subscription OpenAPI contract", () => {
  it("documents organization subscription lookup", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    const responses =
      doc.paths?.["/{id}/organizations/{organizationId}/subscription"]?.get
        ?.responses;

    expect(responses).toBeDefined();
    expect(responses).toHaveProperty("200");
  });
});

describe("users/check-emails OpenAPI contract", () => {
  it("documents bulk email check endpoint", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    const responses = doc.paths?.["/check-emails"]?.post?.responses;
    expect(responses).toBeDefined();
    expect(responses).toHaveProperty("200");
  });
});

describe("users/{id}/onboarding/status OpenAPI contract", () => {
  it("documents onboarding status endpoint", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    const responses = doc.paths?.["/{id}/onboarding/status"]?.get?.responses;
    expect(responses).toBeDefined();
    expect(JSON.stringify(responses?.["200"])).toContain("show");
  });
});
