"use server";

import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export const deleteSeoAuditAction = withSession<
  AuthenticatedRequest & { auditId: string },
  ActionResultDto<null, ActionError>
>(async ({ auditId }) => {
  if (!z.uuid().safeParse(auditId).success)
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  try {
    await seoServiceNoRedirect.deleteAudit(auditId);
    revalidatePath("/seo");
    return toActionResult(ok(null));
  } catch (error) {
    return toActionResult(
      err({
        ...toCoreApiActionError(error),
        ...(error instanceof CoreApiRequestError
          ? { status: error.status }
          : {}),
      }),
    );
  }
});
