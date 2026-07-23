import {
  NextJobAction,
  NextJobActionErrorType,
  OnChainTransactionStatus,
  SokosumiJobStatus,
} from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import {
  NextJobAction as PrismaNextJobAction,
  NextJobActionErrorType as PrismaNextJobActionErrorType,
  OnChainTransactionStatus as PrismaOnChainTransactionStatus,
  VendorMemberRole as PrismaVendorMemberRole,
} from "../../generated/prisma/enums.js";
import { InvitationStatus } from "../invitation.js";
import { MemberRole } from "../organization.js";

/**
 * Drift guards after SOK-595 (utils domain shrink).
 *
 * Prisma-generated enums are the source of truth for Core OpenAPI domain
 * enums (`apps/core/src/schemas/domain-enums.schema.ts` imports them; Core
 * schema tests assert OpenAPI ↔ Prisma). Web generated client shape is locked
 * in `apps/web/src/lib/clients/__tests__/core-enums-drift.test.ts`.
 *
 * This file only guards mirrors that still live outside Prisma codegen:
 * - Masumi protocol maps in `@sokosumi/utils` ↔ Prisma
 * - `SokosumiJobStatus` (no Prisma enum)
 * - Database `MemberRole` / `InvitationStatus` value locks
 */
describe("status enum drift guard", () => {
  it("utils NextJobAction matches the Prisma-generated NextJobAction enum", () => {
    expect({ ...NextJobAction }).toEqual({ ...PrismaNextJobAction });
  });

  it("utils NextJobActionErrorType matches the Prisma-generated NextJobActionErrorType enum", () => {
    expect({ ...NextJobActionErrorType }).toEqual({
      ...PrismaNextJobActionErrorType,
    });
  });

  it("utils OnChainTransactionStatus matches the Prisma-generated OnChainTransactionStatus enum", () => {
    expect({ ...OnChainTransactionStatus }).toEqual({
      ...PrismaOnChainTransactionStatus,
    });
  });

  it("Prisma VendorMemberRole keeps canonical vendor membership values", () => {
    expect({ ...PrismaVendorMemberRole }).toEqual({
      admin: "admin",
      developer: "developer",
    });
  });

  it("database MemberRole keeps canonical organization role values", () => {
    expect({
      OWNER: MemberRole.OWNER,
      ADMIN: MemberRole.ADMIN,
      MEMBER: MemberRole.MEMBER,
    }).toEqual({
      OWNER: "owner",
      ADMIN: "admin",
      MEMBER: "member",
    });
  });

  it("database InvitationStatus keeps persisted statuses plus frontend-only EXPIRED", () => {
    const { EXPIRED: _expired, ...persistedStatuses } = InvitationStatus;

    expect(persistedStatuses).toEqual({
      PENDING: "pending",
      ACCEPTED: "accepted",
      REJECTED: "rejected",
      CANCELED: "canceled",
    });
    expect(InvitationStatus.EXPIRED).toBe("expired");
  });

  it("SokosumiJobStatus keeps its canonical lowercase string values", () => {
    // SokosumiJobStatus has no Prisma counterpart; lock the values so the
    // shared map cannot drift unnoticed.
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
