import { describe, expect, it } from "vitest";

import { organizationWithRoleSchema } from "./organization.schema";

describe("organizationWithRoleSchema", () => {
  it("accepts null subscription", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      role: "member",
      credits: 100,
      subscription: null,
    });

    expect(result.subscription).toBeNull();
  });

  it("accepts a populated subscription", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      role: "member",
      credits: 100,
      subscription: {
        plan: "starter",
        status: "active",
        periodStart: "2025-01-01T00:00:00.000Z",
        periodEnd: "2025-02-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        credits: {
          total: 100,
          remaining: 76,
          used: 24,
        },
      },
    });

    expect(result.subscription?.plan).toBe("starter");
  });

  it("accepts populated subscription with null usage", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      role: "member",
      credits: 100,
      subscription: {
        plan: "starter",
        status: "active",
        periodStart: "2025-01-01T00:00:00.000Z",
        periodEnd: "2025-02-01T00:00:00.000Z",
        cancelAtPeriodEnd: false,
        credits: null,
      },
    });

    expect(result.subscription?.credits).toBeNull();
  });
});
