import { describe, expect, it } from "vitest";

import { organizationWithRoleSchema } from "./organization.schema";

describe("organizationWithRoleSchema", () => {
  it("accepts base organization with role", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      logo: "https://example.com/logo.png",
      role: "member",
    });

    expect(result.role).toBe("member");
    expect(result.logo).toBe("https://example.com/logo.png");
  });

  it("strips legacy credits field when provided", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      logo: null,
      role: "member",
      credits: 100,
    });

    expect(result).not.toHaveProperty("credits");
  });

  it("strips legacy subscription field when provided", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      logo: null,
      role: "member",
      subscription: {
        plan: "starter",
        status: "active",
        periodStart: "2025-01-01T00:00:00.000Z",
        periodEnd: "2025-02-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        credits: null,
      },
    });

    expect(result).not.toHaveProperty("subscription");
  });

  it("rejects empty-string logo (invalid http URL)", () => {
    expect(() =>
      organizationWithRoleSchema.parse({
        id: "org_123",
        createdAt: "2025-01-01T00:00:00.000Z",
        name: "My Organization",
        slug: "my-org",
        logo: "",
        role: "member",
      }),
    ).toThrow();
  });
});
