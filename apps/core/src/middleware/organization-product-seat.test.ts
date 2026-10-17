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

  it("skips coworker actors so in-flight work can continue", () => {
    expect(
      resolveOrganizationProductSeatUser({
        actor: "coworker",
        coworkerId: "cow-1",
        vendorId: "vendor-1",
        context: { userId: "user-1", organizationId: "org-1" },
      }),
    ).toBeNull();
  });

  it("keeps the owner seat check for a personal Soko Bot", () => {
    expect(
      resolveOrganizationProductSeatUser({
        actor: "sokoBot",
        scope: "personal",
        sokoBotId: "bot-1",
        userId: "user-1",
        workspaceId: "ws-1",
        organizationId: "org-1",
      }),
    ).toEqual({ organizationId: "org-1", userId: "user-1" });
  });

  it("skips a shared Soko Bot, which has no seat of its own", () => {
    expect(
      resolveOrganizationProductSeatUser({
        actor: "sokoBot",
        scope: "workspace",
        sokoBotId: "bot-1",
        userId: null,
        workspaceId: "ws-1",
        organizationId: "org-1",
        projectId: null,
      }),
    ).toBeNull();
  });
});
