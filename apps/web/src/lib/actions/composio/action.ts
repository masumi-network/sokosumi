"use server";

import { err, ok } from "neverthrow";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors";
import { coreClient, toCoreApiActionError } from "@/lib/clients/core.client";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface CompleteComposioCallbackParameters extends AuthenticatedRequest {
  connectionId: string;
  sessionUri: string;
}

/** Redeems a one-use callback session before its owning flow finalizes OAuth. */
export const completeComposioAuthCallbackAction = withSession<
  CompleteComposioCallbackParameters,
  ActionResultDto<void, ActionError>
>(async ({ connectionId, sessionUri }) => {
  try {
    await coreClient.completeComposioCallback({ connectionId, sessionUri });
    return toActionResult(ok());
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
