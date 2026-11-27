"use server";

import type { AdminPreprodAccess } from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
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
import {
  adminPreprodAccessService,
  type PreprodAccessTarget,
} from "@/lib/services/admin-preprod-access.service";
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

interface SetAdminPreprodAccessRequest extends AuthenticatedRequest {
  target: PreprodAccessTarget;
  enabled: boolean;
  reason: string;
}

/**
 * Switches Preprod access for a user or an Organization. Core accepts only an
 * admin's own browser session; the Core client forwards this request's cookie.
 * The page's next render shows the result.
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

  const { target: parsedTarget, ...body } = parsed.data;
  try {
    return toActionResult(
      ok(await adminPreprodAccessService.set(parsedTarget, body)),
    );
  } catch (error) {
    unstable_rethrow(error);
    return toActionResult(err(toCoreApiActionError(error)));
  } finally {
    // Core answered or the request failed midway: the page reads again, so
    // the switch shows what Core holds now.
    refresh();
  }
});
