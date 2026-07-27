import { describe, expect, it } from "vitest";

import {
  canRevokeInviteLink,
  evaluateInviteLinkStatus,
  type InviteLinkStatusFields,
} from "../organization-invite-link.js";

const NOW = new Date("2026-07-25T12:00:00.000Z");

function link(
  overrides: Partial<InviteLinkStatusFields> = {},
): InviteLinkStatusFields {
  return {
    revokedAt: null,
    expiresAt: new Date("2026-07-30T12:00:00.000Z"),
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

  it("accepts ISO string dates (Core DTO / web shapes)", () => {
    expect(
      evaluateInviteLinkStatus(
        link({
          expiresAt: "2026-07-30T12:00:00.000Z",
          revokedAt: null,
        }),
        NOW,
      ),
    ).toBe("valid");
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

describe("canRevokeInviteLink", () => {
  it("allows revoke for non-revoked links", () => {
    expect(canRevokeInviteLink(link(), NOW)).toBe(true);
    expect(
      canRevokeInviteLink(
        link({ expiresAt: new Date("2026-07-01T12:00:00.000Z") }),
        NOW,
      ),
    ).toBe(true);
  });

  it("blocks revoke for already revoked links", () => {
    expect(
      canRevokeInviteLink(
        link({ revokedAt: new Date("2026-07-24T12:00:00.000Z") }),
        NOW,
      ),
    ).toBe(false);
  });
});
