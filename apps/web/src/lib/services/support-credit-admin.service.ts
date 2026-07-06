import "server-only";

import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";

import { coreClient } from "@/lib/clients/core.client";
import { CoreApiRequestError } from "@/lib/clients/core.shared";

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

function mapCoreError(error: unknown): never {
  if (
    error instanceof CoreApiRequestError &&
    error.kind === CORE_API_ERROR_KINDS.SUPPORT_CREDIT_INVALID
  ) {
    throw new SupportCreditValidationError(error.message);
  }

  throw error;
}

/**
 * Admin support credit grants. Credits are created directly in Core without
 * going through Stripe.
 */
export const supportCreditAdminService = {
  async grantSupportCredits(params: {
    target: SupportCreditTarget;
    credits: number;
    ttlDays: number | null;
    referenceNote: string | null;
  }): Promise<SupportCreditGrant> {
    const response = await coreClient
      .createAdminSupportCreditGrant({
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
