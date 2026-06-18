import { InvitationStatus, MemberRole } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  INVITATION_DB_STATUS_VALUES,
  invitationStatusSchema,
  MEMBER_ROLE_VALUES,
  memberRoleSchema,
} from "./domain-enums.schema";

describe("domain enum schemas", () => {
  it("memberRoleSchema values match the database MemberRole enum", () => {
    expect([...MEMBER_ROLE_VALUES].sort()).toEqual(
      Object.values(MemberRole).sort(),
    );
  });

  it("invitationStatusSchema values match database InvitationStatus (excluding frontend-only expired)", () => {
    const { EXPIRED: _expired, ...databaseStatuses } = InvitationStatus;

    expect([...INVITATION_DB_STATUS_VALUES].sort()).toEqual(
      Object.values(databaseStatuses).sort(),
    );
    expect(InvitationStatus.EXPIRED).toBe("expired");
  });

  it("memberRoleSchema accepts all member roles and rejects unknown values", () => {
    for (const role of MEMBER_ROLE_VALUES) {
      expect(memberRoleSchema.parse(role)).toBe(role);
    }

    expect(() => memberRoleSchema.parse("superadmin")).toThrow();
  });

  it("invitationStatusSchema accepts all database statuses and rejects unknown values", () => {
    for (const status of INVITATION_DB_STATUS_VALUES) {
      expect(invitationStatusSchema.parse(status)).toBe(status);
    }

    expect(() => invitationStatusSchema.parse("expired")).toThrow();
    expect(() => invitationStatusSchema.parse("unknown")).toThrow();
  });

  /**
   * Phase-1 audit: these schemas still use bare `string` for role/status/kind
   * because the values are external (Stripe, Better Auth platform role, Hermes)
   * rather than Sokosumi Postgres enums. Tighten in a follow-up when sources
   * are catalogued.
   */
  it("documents remaining bare string role/status/kind fields outside phase-1 scope", () => {
    expect([
      "user.schema.ts: role (platform Better Auth role)",
      "subscription.schema.ts: status (Stripe subscription status)",
      "hermes.schema.ts: role, kind (external Hermes API strings)",
    ]).toMatchInlineSnapshot(`
      [
        "user.schema.ts: role (platform Better Auth role)",
        "subscription.schema.ts: status (Stripe subscription status)",
        "hermes.schema.ts: role, kind (external Hermes API strings)",
      ]
    `);
  });
});
