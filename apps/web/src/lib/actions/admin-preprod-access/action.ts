"use server";

import type { AdminPreprodAccess } from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import * as z from "zod";

import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { adminOrganizationService } from "@/lib/services/admin-organization.service";
import { adminUserService } from "@/lib/services/admin-user.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const setPreprodAccessSchema = z.object({
  target: z.discriminatedUnion("type", [
    z.object({ type: z.literal("user"), id: z.string().min(1) }),
    z.object({ type: z.literal("organization"), slug: z.string().min(1) }),
  ]),
  enabled: z.boolean(),
  reason: z.string().trim().min(1).max(500),
});

export type PreprodAccessTarget = z.infer<
  typeof setPreprodAccessSchema
>["target"];

interface SetAdminPreprodAccessRequest extends AuthenticatedRequest {
  target: PreprodAccessTarget;
  enabled: boolean;
  reason: string;
}

/**
 * Switches Preprod access for a user or an Organization. Core accepts only an
 * admin's own browser session; the Core client forwards this request's cookie.
 */
export const setAdminPreprodAccessAction = withSession<
  SetAdminPreprodAccessRequest,
  ActionResultDto<AdminPreprodAccess, ActionError>
>(async ({ session, target, enabled, reason }) => {
  try {
    assertAdminSession(session);
  } catch (error) {
    if (!isAdminAccessRequiredError(error)) {
      throw error;
    }
    return toActionResult(
      err({ code: CommonErrorCode.UNAUTHORIZED, message: error.message }),
    );
  }

  const parsed = setPreprodAccessSchema.safeParse({ target, enabled, reason });
  if (!parsed.success) {
    return toActionResult(err({ code: CommonErrorCode.BAD_INPUT }));
  }

  const body = { enabled: parsed.data.enabled, reason: parsed.data.reason };
  try {
    const access =
      parsed.data.target.type === "user"
        ? await adminUserService.setPreprodAccess(parsed.data.target.id, body)
        : await adminOrganizationService.setPreprodAccess(
            parsed.data.target.slug,
            body,
          );
    return toActionResult(ok(access));
  } catch (error) {
    return toActionResult(err(toCoreApiActionError(error)));
  }
});
