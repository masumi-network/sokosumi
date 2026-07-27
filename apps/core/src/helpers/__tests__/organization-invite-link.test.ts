import type { OrganizationInviteLink } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import { evaluateInviteLinkStatus } from "@/helpers/organization-invite-link";

const NOW = new Date("2026-07-25T12:00:00.000Z");

function link(
  overrides: Partial<OrganizationInviteLink> = {},
): OrganizationInviteLink {
  return {
    id: "link_1",
    token: "tok",
    organizationId: "org_1",
    role: "member",
    createdByUserId: "user_1",
    createdAt: new Date("2026-07-24T12:00:00.000Z"),
    expiresAt: new Date("2026-07-30T12:00:00.000Z"),
    revokedAt: null,
    maxUses: null,
    useCount: 0,
    ...overrides,
  };
}

describe("evaluateInviteLinkStatus", () => {
  it("returns not_found for a null row", () => {
    expect(evaluateInviteLinkStatus(null, NOW)).toBe("not_found");
  });

  it("returns valid for a live, uncapped link", () => {
    expect(evaluateInviteLinkStatus(link(), NOW)).toBe("valid");
  });

  it("prefers revoked over every other state", () => {
    expect(
      evaluateInviteLinkStatus(
        link({
          revokedAt: NOW,
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
          maxUses: 1,
          useCount: 5,
        }),
        NOW,
      ),
    ).toBe("revoked");
  });

  it("returns expired at or past the expiry instant", () => {
    expect(evaluateInviteLinkStatus(link({ expiresAt: NOW }), NOW)).toBe(
      "expired",
    );
    expect(
      evaluateInviteLinkStatus(
        link({ expiresAt: new Date(NOW.getTime() - 1) }),
        NOW,
      ),
    ).toBe("expired");
  });

  it("returns depleted once useCount reaches a set maxUses", () => {
    expect(
      evaluateInviteLinkStatus(link({ maxUses: 3, useCount: 3 }), NOW),
    ).toBe("depleted");
    expect(
      evaluateInviteLinkStatus(link({ maxUses: 3, useCount: 2 }), NOW),
    ).toBe("valid");
  });

  it("never depletes an uncapped link no matter the count", () => {
    expect(
      evaluateInviteLinkStatus(link({ maxUses: null, useCount: 9999 }), NOW),
    ).toBe("valid");
  });
});
