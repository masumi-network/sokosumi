"use server";

import type { EvalRun } from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
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
import { ADMIN_EVALS_ROUTE } from "@/lib/constants/admin-evals";
import { adminEvalsService } from "@/lib/services/admin-evals.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const createRunSchema = z.object({
  suites: z.array(z.enum(["soko-bot", "cmo"])).min(1),
  repeats: z.number().int().min(1).max(3),
  caseIds: z.array(z.string().trim().min(1)).max(200).optional(),
});

function mapError(error: unknown): ActionError {
  if (isAdminAccessRequiredError(error)) {
    return { code: CommonErrorCode.UNAUTHORIZED, message: error.message };
  }
  return toCoreApiActionError(error);
}

interface CreateRunParams extends AuthenticatedRequest {
  suites: unknown;
  repeats: unknown;
  caseIds?: unknown;
}

export const createAdminEvalRunAction = withSession<
  CreateRunParams,
  ActionResultDto<EvalRun, ActionError>
>(async ({ session, suites, repeats, caseIds }) => {
  try {
    assertAdminSession(session);
    const parsed = createRunSchema.safeParse({ suites, repeats, caseIds });
    if (!parsed.success) {
      return toActionResult(
        err({ code: CommonErrorCode.BAD_INPUT, message: "Invalid input" }),
      );
    }
    const run = await adminEvalsService.createRun({
      suites: parsed.data.suites,
      repeats: parsed.data.repeats,
      caseIds: parsed.data.caseIds?.length ? parsed.data.caseIds : undefined,
    });
    revalidatePath(ADMIN_EVALS_ROUTE);
    return toActionResult(ok(run));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});

interface CancelRunParams extends AuthenticatedRequest {
  runId: unknown;
}

export const cancelAdminEvalRunAction = withSession<
  CancelRunParams,
  ActionResultDto<EvalRun, ActionError>
>(async ({ session, runId }) => {
  try {
    assertAdminSession(session);
    const parsed = z.uuid().safeParse(runId);
    if (!parsed.success) {
      return toActionResult(
        err({ code: CommonErrorCode.BAD_INPUT, message: "Invalid input" }),
      );
    }
    const run = await adminEvalsService.cancelRun(parsed.data);
    revalidatePath(ADMIN_EVALS_ROUTE);
    revalidatePath(`${ADMIN_EVALS_ROUTE}/runs/${parsed.data}`);
    return toActionResult(ok(run));
  } catch (error) {
    return toActionResult(err(mapError(error)));
  }
});
