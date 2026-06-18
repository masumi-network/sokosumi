import { InvitationStatus, MemberRole } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  INVITATION_DB_STATUS_VALUES,
  invitationStatusSchema,
  MEMBER_ROLE_VALUES,
  memberRoleNullableSchema,
  memberRoleSchema,
  STRIPE_SUBSCRIPTION_STATUS_VALUES,
  stripeSubscriptionStatusNullableSchema,
  stripeSubscriptionStatusSchema,
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

  it("memberRoleNullableSchema accepts member roles and null, rejects unknown values", () => {
    for (const role of MEMBER_ROLE_VALUES) {
      expect(memberRoleNullableSchema.parse(role)).toBe(role);
    }

    expect(memberRoleNullableSchema.parse(null)).toBeNull();
    expect(() => memberRoleNullableSchema.parse("superadmin")).toThrow();
  });

  it("stripeSubscriptionStatusSchema accepts Stripe statuses and rejects unknown values", () => {
    for (const status of STRIPE_SUBSCRIPTION_STATUS_VALUES) {
      expect(stripeSubscriptionStatusSchema.parse(status)).toBe(status);
    }

    expect(() => stripeSubscriptionStatusSchema.parse("unknown")).toThrow();
  });

  it("stripeSubscriptionStatusNullableSchema accepts Stripe statuses and null", () => {
    for (const status of STRIPE_SUBSCRIPTION_STATUS_VALUES) {
      expect(stripeSubscriptionStatusNullableSchema.parse(status)).toBe(status);
    }

    expect(stripeSubscriptionStatusNullableSchema.parse(null)).toBeNull();
    expect(() =>
      stripeSubscriptionStatusNullableSchema.parse("unknown"),
    ).toThrow();
  });
});

/*
 * Phase-1 audit (deferred): these schemas still use bare `string` for
 * role/kind because the values are intentionally open-ended rather than
 * Sokosumi Postgres enums. Tighten in a follow-up only if the source contracts
 * become closed sets:
 *   - user.schema.ts: role (platform Better Auth role)
 *   - hermes.schema.ts: role, kind (external Hermes API strings)
 */
