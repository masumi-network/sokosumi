import { describe, expect, it } from "vitest";

import usersRouter from "./index";

describe("users routes OpenAPI contract", () => {
  it("exposes the coworker magic-link invite endpoint", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    const magicLinkResponses = doc.paths?.["/magic-link"]?.post?.responses;

    expect(magicLinkResponses).toBeDefined();
    expect(magicLinkResponses).toHaveProperty("200");
    expect(magicLinkResponses).toHaveProperty("400");
    expect(magicLinkResponses).toHaveProperty("401");
    expect(magicLinkResponses).toHaveProperty("403");
    expect(magicLinkResponses).toHaveProperty("409");
  });

  it("does not expose the organization details endpoint under /users/me", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users API",
        version: "1.0.0",
      },
    });

    expect(doc.paths?.["/me/organizations"]?.get).toBeDefined();
    expect(doc.paths?.["/me/organizations/{id}"]?.get).toBeUndefined();
  });
});
