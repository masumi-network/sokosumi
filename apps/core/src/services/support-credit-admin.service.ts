import { randomUUID } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import {
  getCreditExpiryDate,
  grantSupportCredits,
} from "@sokosumi/database/helpers";
import {
  memberRepository,
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";

import prisma from "@/lib/db/prisma";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

const MAX_TTL_DAYS = 3650;

export type SupportCreditTargetType = "user" | "organization";

export interface SupportCreditTarget {
  targetType: SupportCreditTargetType;
  targetId: string;
}

export interface SupportCreditGrant {
  bucketId: string;
  targetType: SupportCreditTargetType;
  targetId: string;
  targetName: string;
  credits: number;
  ttlDays: number | null;
  referenceNote: string | null;
}

export class SupportCreditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupportCreditValidationError";
  }
}

function isPositiveIntegerCredits(credits: number): boolean {
  return Number.isFinite(credits) && Number.isInteger(credits) && credits > 0;
}

function normalizeReferenceNote(referenceNote: string | null): string | null {
  if (referenceNote === null) {
    return null;
  }

  const trimmed = referenceNote.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveTarget(
  target: SupportCreditTarget,
  tx: Prisma.TransactionClient,
): Promise<{ id: string; name: string; transactionUserId: string }> {
  if (target.targetType === "user") {
    const user = await userRepository.getUserById(target.targetId, tx);
    if (!user) {
      throw new SupportCreditValidationError("User not found");
    }

    return {
      id: user.id,
      name: user.name,
      transactionUserId: user.id,
    };
  }

  const organization =
    await organizationRepository.getOrganizationWithRelationsById(
      target.targetId,
      tx,
    );
  if (!organization) {
    throw new SupportCreditValidationError("Organization not found");
  }

  const ownerUserId = await memberRepository.getOrganizationOwnerUserId(
    organization.id,
    tx,
  );
  if (!ownerUserId) {
    throw new SupportCreditValidationError("Organization has no owner");
  }

  return {
    id: organization.id,
    name: organization.name,
    transactionUserId: ownerUserId,
  };
}

export const supportCreditAdminService = {
  async grantSupportCredits(params: {
    target: SupportCreditTarget;
    credits: number;
    ttlDays: number | null;
    referenceNote: string | null;
  }): Promise<SupportCreditGrant> {
    if (!isPositiveIntegerCredits(params.credits)) {
      throw new SupportCreditValidationError(
        "Credits must be a positive integer",
      );
    }

    if (params.ttlDays !== null) {
      if (
        !Number.isInteger(params.ttlDays) ||
        params.ttlDays <= 0 ||
        params.ttlDays > MAX_TTL_DAYS
      ) {
        throw new SupportCreditValidationError(
          `Expiry must be a positive integer of at most ${MAX_TTL_DAYS} days`,
        );
      }
    }

    const referenceNote = normalizeReferenceNote(params.referenceNote);
    const grantedAt = new Date();
    const expiresAt =
      params.ttlDays === null
        ? null
        : getCreditExpiryDate(grantedAt, params.ttlDays);
    const grantId = randomUUID();

    return await prisma.$transaction(async (tx) => {
      const target = await resolveTarget(params.target, tx);
      const organizationId =
        params.target.targetType === "organization" ? target.id : null;

      const { bucketId } = await grantSupportCredits(
        {
          credits: params.credits,
          expiresAt,
          grantId,
          organizationId,
          referenceNote,
          targetId: target.id,
          targetType: params.target.targetType,
          transactionUserId: target.transactionUserId,
        },
        tx,
      );

      await markOutOfCreditsTasksAsToppedUp({
        organizationId,
        tx,
        userId: target.transactionUserId,
      });

      return {
        bucketId,
        targetType: params.target.targetType,
        targetId: target.id,
        targetName: target.name,
        credits: params.credits,
        ttlDays: params.ttlDays,
        referenceNote,
      };
    });
  },
};
