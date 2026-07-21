import {
  AgentJobStatus,
  AgentStatus,
  BlobStatus,
  Channel,
  InvitationStatus,
  JobType,
  MemberRole,
  NoticeKind,
  OnChainJobStatus,
  RiskClassification,
  TaskStatus,
} from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  agentJobStatusSchema,
  agentStatusSchema,
  blobStatusSchema,
  channelSchema,
  INVITATION_DB_STATUS_VALUES,
  invitationStatusSchema,
  jobTypeSchema,
  MEMBER_ROLE_VALUES,
  memberRoleNullableSchema,
  memberRoleSchema,
  noticeKindSchema,
  onChainJobStatusSchema,
  riskClassificationSchema,
  STRIPE_SUBSCRIPTION_STATUS_VALUES,
  sokosumiJobStatusSchema,
  stripeSubscriptionStatusNullableSchema,
  stripeSubscriptionStatusSchema,
  taskStatusSchema,
} from "./domain-enums.schema";

/**
 * Schema options ↔ Prisma / `@sokosumi/database` (SokosumiJobStatus from utils).
 * Web generated-client drift is guarded separately in apps/web.
 */
describe("domain enum schemas", () => {
  it("named TaskStatus schema values match Prisma", () => {
    expect([...taskStatusSchema.options].sort()).toEqual(
      Object.values(TaskStatus).sort(),
    );
  });

  it("named AgentStatus schema values match Prisma", () => {
    expect([...agentStatusSchema.options].sort()).toEqual(
      Object.values(AgentStatus).sort(),
    );
  });

  it("named AgentJobStatus schema values match Prisma", () => {
    expect([...agentJobStatusSchema.options].sort()).toEqual(
      Object.values(AgentJobStatus).sort(),
    );
  });

  it("named JobType schema values match Prisma", () => {
    expect([...jobTypeSchema.options].sort()).toEqual(
      Object.values(JobType).sort(),
    );
  });

  it("named BlobStatus schema values match Prisma", () => {
    expect([...blobStatusSchema.options].sort()).toEqual(
      Object.values(BlobStatus).sort(),
    );
  });

  it("named Channel schema values match Prisma", () => {
    expect([...channelSchema.options].sort()).toEqual(
      Object.values(Channel).sort(),
    );
  });

  it("named SokosumiJobStatus schema values match utils", () => {
    expect([...sokosumiJobStatusSchema.options].sort()).toEqual(
      Object.values(SokosumiJobStatus).sort(),
    );
  });

  it("named OnChainJobStatus schema values match Prisma", () => {
    expect([...onChainJobStatusSchema.options].sort()).toEqual(
      Object.values(OnChainJobStatus).sort(),
    );
  });

  it("named NoticeKind schema values match Prisma", () => {
    expect([...noticeKindSchema.options].sort()).toEqual(
      Object.values(NoticeKind).sort(),
    );
  });

  it("named RiskClassification schema values match Prisma", () => {
    expect([...riskClassificationSchema.options].sort()).toEqual(
      Object.values(RiskClassification).sort(),
    );
  });

  it("memberRoleSchema values match database MemberRole", () => {
    expect([...MEMBER_ROLE_VALUES].sort()).toEqual(
      Object.values(MemberRole).sort(),
    );
  });

  it("invitationStatusSchema values match database InvitationStatus (excluding frontend-only expired)", () => {
    const { EXPIRED: _expired, ...persistedStatuses } = InvitationStatus;

    expect([...INVITATION_DB_STATUS_VALUES].sort()).toEqual(
      Object.values(persistedStatuses).sort(),
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
