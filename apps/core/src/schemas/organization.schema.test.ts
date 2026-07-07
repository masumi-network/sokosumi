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
      metadata: {
        url: "https://example.com",
      },
      role: "member",
    });

    expect(result.role).toBe("member");
    expect(result.logo).toBe("https://example.com/logo.png");
    expect(result.metadata).toEqual({
      url: "https://example.com",
    });
  });

  it("strips legacy invoiceEmail from metadata", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      logo: null,
      metadata: {
        url: "https://example.com",
        invoiceEmail: "legacy@example.com",
      },
      role: "member",
    });

    expect(result.metadata).toEqual({
      url: "https://example.com",
    });
  });

  it("strips legacy credits field when provided", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      logo: null,
      metadata: null,
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
      metadata: null,
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

  it("accepts empty-string logo", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      logo: "",
      metadata: null,
      role: "member",
    });

    expect(result.logo).toBe("");
  });

  it("maps invalid logo URLs to null instead of failing validation", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      logo: "not-a-url",
      metadata: null,
      role: "member",
    });

    expect(result.logo).toBeNull();
  });

  it("normalizes IPFS logo values before validation", () => {
    const result = organizationWithRoleSchema.parse({
      id: "org_123",
      createdAt: "2025-01-01T00:00:00.000Z",
      name: "My Organization",
      slug: "my-org",
      logo: "ipfs://acme-logo",
      metadata: null,
      role: "member",
    });

    expect(result.logo).toBe("https://c-ipfs-gw.nmkr.io/ipfs/acme-logo");
  });
});
