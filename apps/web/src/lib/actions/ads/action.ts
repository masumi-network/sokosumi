"use server";

import type {
  FinalizeProjectAdConnectionResponse,
  InitiateProjectSocialConnectionResponse,
  ProjectAdAccount,
  ProjectAdProvider,
} from "@sokosumi/core-client";
import { err, ok } from "neverthrow";
import { revalidatePath } from "next/cache";
import {
  type ActionResultDto,
  toActionResult,
} from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { AdsErrorCode } from "@/lib/actions/errors/error-codes/ads";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import { adsService } from "@/lib/services/ads.service";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface InitiateAdConnectionParameters extends AuthenticatedRequest {
  projectId: string;
  provider: ProjectAdProvider;
}

interface FinalizeAdConnectionParameters extends AuthenticatedRequest {
  projectId: string;
  connectionId: string;
}

interface AttachAdAccountsParameters extends AuthenticatedRequest {
  projectId: string;
  adConnectionId: string;
  externalAccountIds: string[];
}

interface DisconnectAdAccountParameters extends AuthenticatedRequest {
  projectId: string;
  accountId: string;
}

/**
 * Core answers 503 when a provider has no Composio auth config. The shared
 * mapper flattens that into a generic outage, so it is named here for the UI
 * to say "isn't available yet" instead of "failed".
 */
function toAdsActionError(error: unknown): ActionError {
  if (error instanceof CoreApiRequestError && error.status === 503) {
    return { code: AdsErrorCode.NOT_CONFIGURED, message: error.message };
  }
  return toCoreApiActionError(error);
}

function badInput(message: string) {
  return toActionResult(err({ code: CommonErrorCode.BAD_INPUT, message }));
}

export const initiateAdConnection = withSession<
  InitiateAdConnectionParameters,
  ActionResultDto<InitiateProjectSocialConnectionResponse, ActionError>
>(async ({ projectId, provider }) => {
  const normalizedProjectId = projectId.trim();
  if (!normalizedProjectId) return badInput("Project required");

  try {
    const initiation = await adsService.initiateConnection(
      normalizedProjectId,
      provider,
    );
    return toActionResult(ok(initiation));
  } catch (error) {
    return toActionResult(err(toAdsActionError(error)));
  }
});

export const finalizeAdConnection = withSession<
  FinalizeAdConnectionParameters,
  ActionResultDto<FinalizeProjectAdConnectionResponse, ActionError>
>(async ({ projectId, connectionId }) => {
  const normalizedProjectId = projectId.trim();
  const normalizedConnectionId = connectionId.trim();
  if (!normalizedProjectId || !normalizedConnectionId) {
    return badInput("Ad connection required");
  }

  try {
    const finalization = await adsService.finalizeConnection(
      normalizedProjectId,
      normalizedConnectionId,
    );
    return toActionResult(ok(finalization));
  } catch (error) {
    return toActionResult(err(toAdsActionError(error)));
  }
});

export const attachAdAccounts = withSession<
  AttachAdAccountsParameters,
  ActionResultDto<ProjectAdAccount[], ActionError>
>(async ({ projectId, adConnectionId, externalAccountIds }) => {
  const normalizedProjectId = projectId.trim();
  const normalizedConnectionId = adConnectionId.trim();
  if (
    !normalizedProjectId ||
    !normalizedConnectionId ||
    externalAccountIds.length === 0
  ) {
    return badInput("Ad accounts required");
  }

  try {
    const accounts = await adsService.attachAccounts(
      normalizedProjectId,
      normalizedConnectionId,
      externalAccountIds,
    );
    revalidatePath("/ads");
    return toActionResult(ok(accounts));
  } catch (error) {
    return toActionResult(err(toAdsActionError(error)));
  }
});

export const disconnectAdAccount = withSession<
  DisconnectAdAccountParameters,
  ActionResultDto<void, ActionError>
>(async ({ projectId, accountId }) => {
  const normalizedProjectId = projectId.trim();
  const normalizedAccountId = accountId.trim();
  if (!normalizedProjectId || !normalizedAccountId) {
    return badInput("Ad account required");
  }

  try {
    await adsService.disconnectAccount(
      normalizedProjectId,
      normalizedAccountId,
    );
    revalidatePath("/ads");
    return toActionResult(ok());
  } catch (error) {
    return toActionResult(err(toAdsActionError(error)));
  }
});
