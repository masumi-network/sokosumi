import {
  AgentJobStatus as UtilsAgentJobStatus,
  BlobStatus as UtilsBlobStatus,
  Channel as UtilsChannel,
  InvitationStatus as UtilsInvitationStatus,
  JobType as UtilsJobType,
  MemberRole as UtilsMemberRole,
  NoticeKind as UtilsNoticeKind,
  OnChainJobStatus as UtilsOnChainJobStatus,
  RiskClassification as UtilsRiskClassification,
  SokosumiJobStatus as UtilsSokosumiJobStatus,
  TaskStatus as UtilsTaskStatus,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  AgentJobStatus,
  BlobStatus,
  Channel,
  InvitationStatus,
  JobType,
  MemberRole,
  NoticeKind,
  OnChainJobStatus,
  type PublicSharedTaskMilestone,
  RiskClassification,
  SokosumiJobStatus,
  StripeSubscriptionStatus,
  TaskStatus,
} from "@/lib/clients/generated/core";

/**
 * Drift guard: generated Core OpenAPI const enums must stay aligned with the
 * client-safe `@sokosumi/utils` maps. Those utils maps are themselves guarded
 * against Prisma in `packages/database` (`status-enums-drift.test.ts`), so
 * this closes the generated → Prisma chain without importing Prisma into web.
 */
describe("generated Core enum drift guard", () => {
  it("TaskStatus matches utils (and therefore Prisma)", () => {
    expect({ ...TaskStatus }).toEqual({ ...UtilsTaskStatus });
  });

  it("SokosumiJobStatus matches utils", () => {
    expect({ ...SokosumiJobStatus }).toEqual({ ...UtilsSokosumiJobStatus });
  });

  it("JobType matches utils (and therefore Prisma)", () => {
    expect({ ...JobType }).toEqual({ ...UtilsJobType });
  });

  it("AgentJobStatus matches utils (and therefore Prisma)", () => {
    expect({ ...AgentJobStatus }).toEqual({ ...UtilsAgentJobStatus });
  });

  it("OnChainJobStatus matches utils (and therefore Prisma)", () => {
    expect({ ...OnChainJobStatus }).toEqual({ ...UtilsOnChainJobStatus });
  });

  it("BlobStatus matches utils (and therefore Prisma)", () => {
    expect({ ...BlobStatus }).toEqual({ ...UtilsBlobStatus });
  });

  it("Channel matches utils (and therefore Prisma)", () => {
    expect({ ...Channel }).toEqual({ ...UtilsChannel });
  });

  it("NoticeKind matches utils (and therefore Prisma)", () => {
    expect({ ...NoticeKind }).toEqual({ ...UtilsNoticeKind });
  });

  it("RiskClassification matches utils (and therefore Prisma)", () => {
    expect({ ...RiskClassification }).toEqual({
      ...UtilsRiskClassification,
    });
  });

  it("MemberRole matches utils", () => {
    expect({ ...MemberRole }).toEqual({ ...UtilsMemberRole });
  });

  it("InvitationStatus matches utils database statuses (no frontend-only expired)", () => {
    const { EXPIRED: _expired, ...utilsDbStatuses } = UtilsInvitationStatus;
    expect({ ...InvitationStatus }).toEqual(utilsDbStatuses);
  });

  it("web can import TaskStatus.RUNNING from generated Core client", () => {
    expect(TaskStatus.RUNNING).toBe("RUNNING");
  });

  it("StripeSubscriptionStatus runtime map excludes null", () => {
    expect(Object.values(StripeSubscriptionStatus)).not.toContain(null);
    expect(
      "NULL" in StripeSubscriptionStatus || "null" in StripeSubscriptionStatus,
    ).toBe(false);
  });

  it("PublicSharedTaskMilestone.status admits null in the generated type", () => {
    const status: PublicSharedTaskMilestone["status"] = null;
    expect(status).toBeNull();
  });
});
