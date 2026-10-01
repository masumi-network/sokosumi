"use server";

import {
  type FinalizeProjectAdConnectionResponse,
  type InitiateProjectSocialConnectionResponse,
  type ProjectAdAccount,
  ProjectAdProvider,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import * as z from "zod";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import { toCoreApiActionError } from "@/lib/clients/core.client";
import { adsService } from "@/lib/services/ads.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

const trimmedId = z.string().trim().min(1);

/**
 * An ads action: input validated against `schema`, then `run` against Core.
 * Core's errors keep their `kind` (for example "integration_not_configured"),
 * which is what the UI branches on.
 */
function adsAction<S extends z.ZodType, T>(
  schema: S,
  run: (input: z.output<S>) => Promise<T>,
) {
  return withSession<
    z.input<S> & AuthenticatedRequest,
    ActionResultDto<T, ActionError>
  >(async (params) => {
    const parsed = schema.safeParse(params);
    if (!parsed.success) {
      return toActionResult(
        err({
          code: CommonErrorCode.BAD_INPUT,
          message: parsed.error.issues[0]?.message ?? "Invalid ad input",
        }),
      );
    }

    try {
      return toActionResult(ok(await run(parsed.data)));
    } catch (error) {
      return toActionResult(err(toCoreApiActionError(error)));
    }
  });
}

export const initiateAdConnection = adsAction(
  z.object({
    projectId: trimmedId,
    provider: z.enum(ProjectAdProvider),
  }),
  async ({
    projectId,
    provider,
  }): Promise<InitiateProjectSocialConnectionResponse> =>
    adsService.initiateConnection(projectId, provider),
);

export const finalizeAdConnection = adsAction(
  z.object({ projectId: trimmedId, connectionId: trimmedId }),
  async ({
    projectId,
    connectionId,
  }): Promise<FinalizeProjectAdConnectionResponse> =>
    adsService.finalizeConnection(projectId, connectionId),
);

export const attachAdAccounts = adsAction(
  z.object({
    projectId: trimmedId,
    adConnectionId: trimmedId,
    externalAccountIds: z.array(trimmedId).min(1),
  }),
  async ({
    projectId,
    adConnectionId,
    externalAccountIds,
  }): Promise<ProjectAdAccount[]> => {
    const accounts = await adsService.attachAccounts(
      projectId,
      adConnectionId,
      externalAccountIds,
    );
    revalidatePath("/ads");
    return accounts;
  },
);

export const disconnectAdAccount = adsAction(
  z.object({ projectId: trimmedId, accountId: trimmedId }),
  async ({ projectId, accountId }) => {
    await adsService.disconnectAccount(projectId, accountId);
    revalidatePath("/ads");
  },
);

/** Drops a finalized connection nobody attached accounts to. */
export const discardAdConnection = adsAction(
  z.object({ projectId: trimmedId, adConnectionId: trimmedId }),
  async ({ projectId, adConnectionId }) => {
    await adsService.discardConnection(projectId, adConnectionId);
  },
);

/** Pauses or resumes a campaign, or changes its daily budget, in one call. */
export const updateAdCampaign = adsAction(
  z
    .object({
      projectId: trimmedId,
      accountId: trimmedId,
      campaignId: trimmedId,
      status: z.enum(["ACTIVE", "PAUSED"]).optional(),
      dailyBudget: z.number().positive().optional(),
    })
    .refine(
      ({ status, dailyBudget }) =>
        status !== undefined || dailyBudget !== undefined,
      { message: "Nothing to update" },
    ),
  async ({ projectId, accountId, campaignId, status, dailyBudget }) => {
    await adsService.updateCampaign(projectId, accountId, campaignId, {
      ...(status ? { status } : {}),
      ...(dailyBudget !== undefined ? { dailyBudget } : {}),
    });
    revalidatePath("/ads");
  },
);
