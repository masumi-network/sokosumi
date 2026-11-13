"use server";

import { err, ok } from "neverthrow";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { adminAdEvalsService } from "@/lib/services/admin-ad-evals.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export const exportAdminAdEvals = withSession<
  AuthenticatedRequest,
  ActionResultDto<string, ActionError>
>(async ({ session }) => {
  try {
    assertAdminSession(session);
    return toActionResult(ok(await adminAdEvalsService.exportJsonl()));
  } catch (error) {
    if (isAdminAccessRequiredError(error)) {
      return toActionResult(err({ code: CommonErrorCode.UNAUTHORIZED }));
    }
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
