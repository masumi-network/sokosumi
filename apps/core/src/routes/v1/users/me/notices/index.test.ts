import { describe, expect, it } from "vitest";

import usersRouter from "../../index";

describe("users/me notices routes OpenAPI contract", () => {
  it("exposes pending and acknowledge notice routes with expected responses", () => {
    const doc = usersRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const pendingResponses = doc.paths?.["/me/notices/pending"]?.get?.responses;
    const acknowledgeResponses =
      doc.paths?.["/me/notices/{id}/acknowledge"]?.post?.responses;

    expect(pendingResponses).toBeDefined();
    expect(pendingResponses).toHaveProperty("200");
    expect(pendingResponses).toHaveProperty("401");
    expect(pendingResponses).toHaveProperty("403");
    expect(pendingResponses).toHaveProperty("500");

    expect(acknowledgeResponses).toBeDefined();
    expect(acknowledgeResponses).toHaveProperty("200");
    expect(acknowledgeResponses).toHaveProperty("401");
    expect(acknowledgeResponses).toHaveProperty("403");
    expect(acknowledgeResponses).toHaveProperty("404");
    expect(acknowledgeResponses).toHaveProperty("409");
    expect(acknowledgeResponses).toHaveProperty("500");
  });
});
