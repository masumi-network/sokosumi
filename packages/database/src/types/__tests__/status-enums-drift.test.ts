import {
  AgentJobStatus,
  AgentStatus,
  BlobStatus,
  Channel,
  InvitationStatus,
  JobType,
  MemberRole,
  NextJobAction,
  NextJobActionErrorType,
  NoticeKind,
  OnChainJobStatus,
  OnChainTransactionStatus,
  PricingType,
  RiskClassification,
  SokosumiJobStatus,
  TaskLinkType,
  TaskStatus,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  AgentJobStatus as PrismaAgentJobStatus,
  AgentStatus as PrismaAgentStatus,
  BlobStatus as PrismaBlobStatus,
  Channel as PrismaChannel,
  JobType as PrismaJobType,
  NextJobAction as PrismaNextJobAction,
  NextJobActionErrorType as PrismaNextJobActionErrorType,
  NoticeKind as PrismaNoticeKind,
  OnChainJobStatus as PrismaOnChainJobStatus,
  OnChainTransactionStatus as PrismaOnChainTransactionStatus,
  PricingType as PrismaPricingType,
  RiskClassification as PrismaRiskClassification,
  TaskLinkType as PrismaTaskLinkType,
  TaskStatus as PrismaTaskStatus,
} from "../../generated/prisma/enums.js";
import { InvitationStatus as DatabaseInvitationStatus } from "../invitation.js";
import { MemberRole as DatabaseMemberRole } from "../organization.js";

/**
 * `@sokosumi/utils` hosts the client-safe single source of truth for these
 * statuses so the web bundle does not depend on `@sokosumi/database`. The
 * Prisma-generated enums can only be edited via the schema, so guard against
 * silent drift between the two definitions here, where both are importable.
 *
 * Generated Core client const maps (apps/web) are guarded against these utils
 * maps in `apps/web/src/lib/clients/__tests__/core-enums-drift.test.ts`, so
 * generated → utils → Prisma stays a closed chain (SOK-590).
 */
describe("status enum drift guard", () => {
  it("utils TaskStatus matches the Prisma-generated TaskStatus enum", () => {
    expect({ ...TaskStatus }).toEqual({ ...PrismaTaskStatus });
  });

  it("utils AgentJobStatus matches the Prisma-generated AgentJobStatus enum", () => {
    expect({ ...AgentJobStatus }).toEqual({ ...PrismaAgentJobStatus });
  });

  it("utils AgentStatus matches the Prisma-generated AgentStatus enum", () => {
    expect({ ...AgentStatus }).toEqual({ ...PrismaAgentStatus });
  });

  it("utils BlobStatus matches the Prisma-generated BlobStatus enum", () => {
    expect({ ...BlobStatus }).toEqual({ ...PrismaBlobStatus });
  });

  it("utils JobType matches the Prisma-generated JobType enum", () => {
    expect({ ...JobType }).toEqual({ ...PrismaJobType });
  });

  it("utils NoticeKind matches the Prisma-generated NoticeKind enum", () => {
    expect({ ...NoticeKind }).toEqual({ ...PrismaNoticeKind });
  });

  it("utils OnChainJobStatus matches the Prisma-generated OnChainJobStatus enum", () => {
    expect({ ...OnChainJobStatus }).toEqual({ ...PrismaOnChainJobStatus });
  });

  it("utils OnChainTransactionStatus matches the Prisma-generated OnChainTransactionStatus enum", () => {
    expect({ ...OnChainTransactionStatus }).toEqual({
      ...PrismaOnChainTransactionStatus,
    });
  });

  it("utils PricingType matches the Prisma-generated PricingType enum", () => {
    expect({ ...PricingType }).toEqual({ ...PrismaPricingType });
  });

  it("utils RiskClassification matches the Prisma-generated RiskClassification enum", () => {
    expect({ ...RiskClassification }).toEqual({ ...PrismaRiskClassification });
  });

  it("utils Channel matches the Prisma-generated Channel enum", () => {
    expect({ ...Channel }).toEqual({ ...PrismaChannel });
  });

  it("utils TaskLinkType matches the Prisma-generated TaskLinkType enum", () => {
    expect({ ...TaskLinkType }).toEqual({ ...PrismaTaskLinkType });
  });

  it("utils NextJobAction matches the Prisma-generated NextJobAction enum", () => {
    expect({ ...NextJobAction }).toEqual({ ...PrismaNextJobAction });
  });

  it("utils NextJobActionErrorType matches the Prisma-generated NextJobActionErrorType enum", () => {
    expect({ ...NextJobActionErrorType }).toEqual({
      ...PrismaNextJobActionErrorType,
    });
  });

  it("utils MemberRole matches the database MemberRole enum", () => {
    expect({ ...MemberRole }).toEqual({
      OWNER: DatabaseMemberRole.OWNER,
      ADMIN: DatabaseMemberRole.ADMIN,
      MEMBER: DatabaseMemberRole.MEMBER,
    });
  });

  it("utils InvitationStatus matches the database InvitationStatus map (excluding frontend-only EXPIRED)", () => {
    const { EXPIRED: _expired, ...databaseStatuses } = DatabaseInvitationStatus;
    const { EXPIRED: _utilsExpired, ...utilsStatuses } = InvitationStatus;

    expect(utilsStatuses).toEqual(databaseStatuses);
    expect(InvitationStatus.EXPIRED).toBe("expired");
  });

  it("SokosumiJobStatus keeps its canonical lowercase string values", () => {
    // SokosumiJobStatus has no Prisma counterpart; lock the values so the
    // client-safe map cannot drift unnoticed.
    expect({ ...SokosumiJobStatus }).toEqual({
      STARTED: "started",
      COMPLETED: "completed",
      PROCESSING: "processing",
      INPUT_REQUIRED: "input_required",
      RESULT_PENDING: "result_pending",
      FAILED: "failed",
      PAYMENT_PENDING: "payment_pending",
      PAYMENT_FAILED: "payment_failed",
      REFUND_PENDING: "refund_pending",
      REFUND_RESOLVED: "refund_resolved",
      DISPUTE_PENDING: "dispute_pending",
      DISPUTE_RESOLVED: "dispute_resolved",
    });
  });
});
