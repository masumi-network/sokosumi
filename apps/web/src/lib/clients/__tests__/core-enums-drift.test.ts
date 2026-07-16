import { SokosumiJobStatus as UtilsSokosumiJobStatus } from "@sokosumi/utils";
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
 * Drift guard: generated Core OpenAPI const enums must keep stable runtime
 * shapes. Prisma ↔ OpenAPI is asserted in Core
 * (`domain-enums.schema.test.ts`). `SokosumiJobStatus` has no Prisma enum and
 * still lives in `@sokosumi/utils` for Core/DB helpers — parity with that map
 * is checked here.
 */
describe("generated Core enum drift guard", () => {
  it("TaskStatus matches the canonical Prisma/OpenAPI set", () => {
    expect({ ...TaskStatus }).toEqual({
      DRAFT: "DRAFT",
      QUEUED: "QUEUED",
      READY: "READY",
      GRANT_PENDING: "GRANT_PENDING",
      INPUT_REQUIRED: "INPUT_REQUIRED",
      APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
      AUTHENTICATION_REQUIRED: "AUTHENTICATION_REQUIRED",
      OUT_OF_CREDITS: "OUT_OF_CREDITS",
      CREDITS_TOPPED_UP: "CREDITS_TOPPED_UP",
      RUNNING: "RUNNING",
      AWAITING_EXTERNAL: "AWAITING_EXTERNAL",
      COMPLETED: "COMPLETED",
      FAILED: "FAILED",
      CANCEL_REQUESTED: "CANCEL_REQUESTED",
      CANCELED: "CANCELED",
    });
  });

  it("SokosumiJobStatus matches utils (shared Core/DB map)", () => {
    expect({ ...SokosumiJobStatus }).toEqual({ ...UtilsSokosumiJobStatus });
  });

  it("JobType matches the canonical Prisma/OpenAPI set", () => {
    expect({ ...JobType }).toEqual({
      FREE: "FREE",
      PAID: "PAID",
    });
  });

  it("AgentJobStatus matches the canonical Prisma/OpenAPI set", () => {
    expect({ ...AgentJobStatus }).toEqual({
      INITIATED: "INITIATED",
      AWAITING_PAYMENT: "AWAITING_PAYMENT",
      AWAITING_INPUT: "AWAITING_INPUT",
      RUNNING: "RUNNING",
      COMPLETED: "COMPLETED",
      FAILED: "FAILED",
    });
  });

  it("OnChainJobStatus matches the canonical Prisma/OpenAPI set", () => {
    expect({ ...OnChainJobStatus }).toEqual({
      FUNDS_LOCKED: "FUNDS_LOCKED",
      FUNDS_OR_DATUM_INVALID: "FUNDS_OR_DATUM_INVALID",
      FUNDS_WITHDRAWN: "FUNDS_WITHDRAWN",
      RESULT_SUBMITTED: "RESULT_SUBMITTED",
      REFUND_REQUESTED: "REFUND_REQUESTED",
      REFUND_WITHDRAWN: "REFUND_WITHDRAWN",
      DISPUTED: "DISPUTED",
      DISPUTED_WITHDRAWN: "DISPUTED_WITHDRAWN",
    });
  });

  it("BlobStatus matches the canonical Prisma/OpenAPI set", () => {
    expect({ ...BlobStatus }).toEqual({
      PENDING: "PENDING",
      READY: "READY",
      FAILED: "FAILED",
    });
  });

  it("Channel matches the canonical Prisma/OpenAPI set", () => {
    expect({ ...Channel }).toEqual({
      SLACK: "SLACK",
      TEAMS: "TEAMS",
      EMAIL: "EMAIL",
      LINEAR: "LINEAR",
      GITHUB: "GITHUB",
      WHATSAPP: "WHATSAPP",
      TELEGRAM: "TELEGRAM",
      SIGNAL: "SIGNAL",
      DISCORD: "DISCORD",
      CHAT: "CHAT",
      MESSENGER: "MESSENGER",
      SOKOSUMI: "SOKOSUMI",
      UNKNOWN: "UNKNOWN",
    });
  });

  it("NoticeKind matches the canonical Prisma/OpenAPI set", () => {
    expect({ ...NoticeKind }).toEqual({
      LEGAL_TERMS: "LEGAL_TERMS",
      ANNOUNCEMENT: "ANNOUNCEMENT",
    });
  });

  it("RiskClassification matches the canonical Prisma/OpenAPI set", () => {
    expect({ ...RiskClassification }).toEqual({
      MINIMAL: "MINIMAL",
      LIMITED: "LIMITED",
      HIGH: "HIGH",
      UNACCEPTABLE: "UNACCEPTABLE",
    });
  });

  it("MemberRole matches canonical organization roles", () => {
    expect({ ...MemberRole }).toEqual({
      OWNER: "owner",
      ADMIN: "admin",
      MEMBER: "member",
    });
  });

  it("InvitationStatus is persisted statuses only (no frontend-only expired)", () => {
    expect({ ...InvitationStatus }).toEqual({
      PENDING: "pending",
      ACCEPTED: "accepted",
      REJECTED: "rejected",
      CANCELED: "canceled",
    });
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
