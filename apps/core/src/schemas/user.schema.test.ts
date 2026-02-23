import { describe, expect, it } from "vitest";

import { userSchema } from "./user.schema";

describe("userSchema", () => {
  it("keeps role in the parsed user payload", () => {
    const result = userSchema.parse({
      id: "0Lm1hpg77w8g8QXbr3aEsFzX9aIUTybj",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      name: "John Doe",
      email: "john.doe@example.com",
      emailVerified: true,
      image: "https://example.com/image.png",
      role: "admin",
      credits: 100.0,
      subscription: null,
    });

    expect(result.role).toBe("admin");
  });
});
