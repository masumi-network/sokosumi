import { describe, expect, it } from "vitest";

import usersMeRouter from "./index";

describe("users/me get route OpenAPI contract", () => {
  it("includes role in the User response schema", () => {
    const doc = usersMeRouter.getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "Users Me API",
        version: "1.0.0",
      },
    });

    const userSchema = doc.components?.schemas?.User;

    expect(userSchema).toBeDefined();
    expect(userSchema).toHaveProperty("properties.role");
  });
});
