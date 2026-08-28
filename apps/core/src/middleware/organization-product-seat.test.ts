import { describe, expect, it } from "vitest";

import { resolveOrganizationProductSeatUser } from "./organization-product-seat";

describe("resolveOrganizationProductSeatUser", () => {
  it("requires a seat for interactive org members", () => {
    expect(
      resolveOrganizationProductSeatUser({
        actor: "user",
        userId: "user-1",
        organizationId: "org-1",
        role: "user",
      }),
    ).toEqual({ organizationId: "org-1", userId: "user-1" });
  });

  it("skips personal workspace", () => {
    expect(
      resolveOrganizationProductSeatUser({
        actor: "user",
        userId: "user-1",
        organizationId: null,
        role: "user",
      }),
    ).toBeNull();
  });

  it("skips coworker and orchestrator actors so in-flight work can continue", () => {
    expect(
      resolveOrganizationProductSeatUser({
        actor: "coworker",
        coworkerId: "cow-1",
        vendorId: "vendor-1",
        context: { userId: "user-1", organizationId: "org-1" },
      }),
    ).toBeNull();
    expect(
      resolveOrganizationProductSeatUser({
        actor: "orchestrator",
        orchestratorId: "orch-1",
        context: { userId: "user-1", organizationId: "org-1" },
      }),
    ).toBeNull();
  });
});
