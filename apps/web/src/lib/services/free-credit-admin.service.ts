import "server-only";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { coreClient } from "@/lib/clients/core.client";
import { CoreApiRequestError } from "@/lib/clients/core.shared";

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

function mapCoreError(error: unknown): never {
  if (
    error instanceof CoreApiRequestError &&
    error.kind === CORE_API_ERROR_KINDS.FREE_CREDIT_INVALID
  ) {
    throw new FreeCreditValidationError(error.message);
  }

  throw error;
}

/**
 * Admin free credit grants. Credits are created directly in Core without
 * going through Stripe.
 */
export const freeCreditAdminService = {
  async grantFreeCredits(params: {
    target: FreeCreditTarget;
    credits: number;
    ttlDays: number | null;
    referenceNote: string | null;
  }): Promise<FreeCreditGrant> {
    const response = await coreClient
      .createAdminFreeCreditGrant({
        targetType: params.target.targetType,
        targetId: params.target.targetId,
        credits: params.credits,
        ttlDays: params.ttlDays,
        referenceNote: params.referenceNote,
      })
      .catch(mapCoreError);

    return response.data;
  },
};
