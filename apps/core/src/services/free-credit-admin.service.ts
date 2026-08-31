import { randomUUID } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import {
  GrantFreeCreditsError,
  getCreditExpiryDate,
  grantFreeCredits as grantFreeCreditsInDatabase,
} from "@sokosumi/database/helpers";
import {
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { MAX_ADMIN_CREDIT_TTL_DAYS } from "@/lib/admin-credit-grant";
import prisma from "@/lib/db/prisma";
import { markOutOfCreditsTasksAsToppedUp } from "@/services/task-topup.service";

export type FreeCreditTargetType = "user" | "organization";

export interface FreeCreditTarget {
  targetType: FreeCreditTargetType;
  targetId: string;
}

export interface FreeCreditGrant {
  bucketId: string;
  targetType: FreeCreditTargetType;
  targetId: string;
  targetName: string;
  credits: number;
  ttlDays: number | null;
  referenceNote: string | null;
}

export class FreeCreditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FreeCreditValidationError";
  }
}

function isPositiveIntegerCredits(credits: number): boolean {
  return Number.isFinite(credits) && Number.isInteger(credits) && credits > 0;
}

async function resolveTarget(
  target: FreeCreditTarget,
  tx: Prisma.TransactionClient,
): Promise<{ id: string; name: string; transactionUserId: string | null }> {
  if (target.targetType === "user") {
    const user = await userRepository.getUserById(target.targetId, tx);
    if (!user) {
      throw new FreeCreditValidationError("User not found");
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
    throw new FreeCreditValidationError("Organization not found");
  }

  return {
    id: organization.id,
    name: organization.name,
    transactionUserId: null,
  };
}

export const freeCreditAdminService = {
  async grantFreeCredits(params: {
    target: FreeCreditTarget;
    credits: number;
    ttlDays: number | null;
    referenceNote: string | null;
  }): Promise<FreeCreditGrant> {
    if (!isPositiveIntegerCredits(params.credits)) {
      throw new FreeCreditValidationError("Credits must be a positive integer");
    }

    if (params.ttlDays !== null) {
      if (
        !Number.isInteger(params.ttlDays) ||
        params.ttlDays <= 0 ||
        params.ttlDays > MAX_ADMIN_CREDIT_TTL_DAYS
      ) {
        throw new FreeCreditValidationError(
          `Expiry must be a positive integer of at most ${MAX_ADMIN_CREDIT_TTL_DAYS} days`,
        );
      }
    }

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
      const referenceNote = params.referenceNote;

      let bucketId: string;
      try {
        ({ bucketId } = await grantFreeCreditsInDatabase(
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
        ));
      } catch (error) {
        if (error instanceof GrantFreeCreditsError) {
          throw new FreeCreditValidationError(error.message);
        }
        throw error;
      }

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
