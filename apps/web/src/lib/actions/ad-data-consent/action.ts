"use server";

import { err, ok } from "neverthrow";
import { z } from "zod";
import { toActionResult } from "@/lib/actions/action-result";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { adDataConsentService } from "@/lib/services/ad-data-consent.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const consentSchema = z
  .object({
    workspaceId: z.uuid(),
    shareForImprovement: z.boolean(),
    allowTraining: z.boolean(),
  })
  .refine((value) => !value.allowTraining || value.shareForImprovement);

interface SaveConsentParameters extends AuthenticatedRequest {
  workspaceId: string;
  shareForImprovement: boolean;
  allowTraining: boolean;
}

export const saveAdDataConsent = withSession(
  async (params: SaveConsentParameters) => {
    const parsed = consentSchema.safeParse(params);
    if (!parsed.success) {
      return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
    }
    try {
      const { workspaceId, shareForImprovement, allowTraining } = parsed.data;
      const consent = await adDataConsentService.save(
        workspaceId,
        shareForImprovement,
        allowTraining,
      );
      return toActionResult(ok(consent));
    } catch (error) {
      return toActionResult(err(toCoreApiActionError(error)));
    }
  },
);
