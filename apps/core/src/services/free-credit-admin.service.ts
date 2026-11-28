import { randomUUID } from "node:crypto";

import type { Prisma } from "@sokosumi/database";
import {
  GrantFreeCreditsError,
  getCreditExpiryDate,
} from "@sokosumi/database/helpers";
import {
  organizationRepository,
  userRepository,
} from "@sokosumi/database/repositories";
import { MAX_ADMIN_CREDIT_TTL_DAYS } from "@/lib/admin-credit-grant";
import { type CreditOwner, grant as grantCredits } from "@/lib/credits/grant";
import { createNetworkScope } from "@/lib/db/network-scope";
import prisma from "@/lib/db/prisma";

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
): Promise<{ id: string; name: string }> {
  if (target.targetType === "user") {
    const user = await userRepository.getUserById(target.targetId, tx);
    if (!user) {
      throw new FreeCreditValidationError("User not found");
    }

    return { id: user.id, name: user.name };
  }

  const organization =
    await organizationRepository.getOrganizationWithRelationsById(
      target.targetId,
      tx,
    );
  if (!organization) {
    throw new FreeCreditValidationError("Organization not found");
  }

  return { id: organization.id, name: organization.name };
}

/**
 * The owner of free credits. Personal credits have no Project, as the grant
 * has always refused.
 */
function freeCreditOwner(
  targetType: FreeCreditTargetType,
  targetId: string,
  projectId: string | undefined,
): CreditOwner {
  if (targetType === "organization") {
    return {
      userId: null,
      organizationId: targetId,
      projectId: projectId ?? null,
    };
  }
  if (projectId) {
    throw new GrantFreeCreditsError(
      "User free credits cannot be scoped to a Project",
    );
  }
  return { userId: targetId, organizationId: null, projectId: null };
}

export const freeCreditAdminService = {
  /**
   * A `projectId` makes them Project credits of the organization (ADR 0067).
   * A `tx` grants inside the caller's transaction instead of a new one.
   */
  async grantFreeCredits(params: {
    target: FreeCreditTarget;
    projectId?: string;
    credits: number;
    ttlDays: number | null;
    referenceNote: string | null;
    /** FREE unless the grant has a type of its own (Tester credits). */
    referenceType?: "FREE" | "CMO_TESTER_CREDITS";
    tx?: Prisma.TransactionClient;
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

    const grant = async (
      tx: Prisma.TransactionClient,
    ): Promise<FreeCreditGrant> => {
      const target = await resolveTarget(params.target, tx);
      const referenceNote = params.referenceNote;

      let bucketId: string;
      try {
        // Free credits are Mainnet's: named here for every caller.
        ({ bucketId } = await grantCredits({
          scope: createNetworkScope("mainnet"),
          tx,
          kind:
            params.referenceType === "CMO_TESTER_CREDITS"
              ? "cmo_tester"
              : "free",
          owner: freeCreditOwner(
            params.target.targetType,
            target.id,
            params.projectId,
          ),
          credits: params.credits,
          expiresAt,
          grantId,
          note: referenceNote,
          wakeTasks: true,
        }));
      } catch (error) {
        if (error instanceof GrantFreeCreditsError) {
          throw new FreeCreditValidationError(error.message);
        }
        throw error;
      }

      return {
        bucketId,
        targetType: params.target.targetType,
        targetId: target.id,
        targetName: target.name,
        credits: params.credits,
        ttlDays: params.ttlDays,
        referenceNote,
      };
    };
    return params.tx
      ? await grant(params.tx)
      : await prisma.$transaction(grant);
  },
};
