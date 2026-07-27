import { describe, expect, it } from "vitest";

import type { OrganizationInviteLink } from "@/lib/clients/generated/core";
import {
  canRevokeInviteLink,
  evaluateInviteLinkDisplayStatus,
} from "@/lib/utils/organization-invite-link";

const NOW = new Date("2026-07-25T12:00:00.000Z");

function buildLink(
  overrides: Partial<OrganizationInviteLink> = {},
): OrganizationInviteLink {
  return {
    token: "tok_1",
    url: "https://app.sokosumi.test/join/tok_1",
    role: "member",
    createdAt: new Date("2026-07-20T12:00:00.000Z"),
    expiresAt: new Date("2026-08-01T12:00:00.000Z"),
    revokedAt: null,
    maxUses: null,
    useCount: 0,
    ...overrides,
  };
}

describe("evaluateInviteLinkDisplayStatus", () => {
  it("returns revoked when revokedAt is set", () => {
    expect(
      evaluateInviteLinkDisplayStatus(
        buildLink({
          revokedAt: new Date("2026-07-24T12:00:00.000Z"),
          expiresAt: new Date("2026-07-01T12:00:00.000Z"),
          maxUses: 1,
          useCount: 1,
        }),
        NOW,
      ),
    ).toBe("revoked");
  });

  it("returns expired when past expiresAt and not revoked", () => {
    expect(
      evaluateInviteLinkDisplayStatus(
        buildLink({
          expiresAt: new Date("2026-07-01T12:00:00.000Z"),
          maxUses: 1,
          useCount: 1,
        }),
        NOW,
      ),
    ).toBe("expired");
  });

  it("returns depleted when useCount reaches maxUses", () => {
    expect(
      evaluateInviteLinkDisplayStatus(
        buildLink({
          maxUses: 5,
          useCount: 5,
        }),
        NOW,
      ),
    ).toBe("depleted");
  });

  it("returns valid for a live unlimited link", () => {
    expect(evaluateInviteLinkDisplayStatus(buildLink(), NOW)).toBe("valid");
  });
});

describe("canRevokeInviteLink", () => {
  it("allows revoke for non-revoked links", () => {
    expect(canRevokeInviteLink(buildLink(), NOW)).toBe(true);
    expect(
      canRevokeInviteLink(
        buildLink({ expiresAt: new Date("2026-07-01T12:00:00.000Z") }),
        NOW,
      ),
    ).toBe(true);
  });

  it("blocks revoke for already revoked links", () => {
    expect(
      canRevokeInviteLink(
        buildLink({ revokedAt: new Date("2026-07-24T12:00:00.000Z") }),
        NOW,
      ),
    ).toBe(false);
  });
});
