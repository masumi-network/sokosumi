"use server";

import type { PaidSubscriptionPlanName } from "@sokosumi/utils";
import * as z from "zod";
import {
  type ActionError,
  betterAuthApiErrorSchema,
  CommonErrorCode,
} from "@/lib/actions/errors";
import { mapCoreSubscriptionSeatsWriteError } from "@/lib/actions/subscription/map-core-subscription-seats-error";
import type { SubscriptionChangeResult } from "@/lib/auth/subscription.server";
import {
  openOrganizationBillingPortalServer,
  openPersonalBillingPortalServer,
  upgradeOrganizationSubscriptionServer,
  upgradePersonalSubscriptionServer,
} from "@/lib/auth/subscription.server";
import {
  CoreApiRequestError,
  coreClient,
  toCoreApiActionError,
} from "@/lib/clients/core.client";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

export type { SubscriptionChangeResult } from "@/lib/auth/subscription.server";

export async function upgradePersonalSubscription({
  plan,
  returnPath,
}: {
  plan: PaidSubscriptionPlanName;
  returnPath?: string;
}): Promise<Result<SubscriptionChangeResult, ActionError>> {
  return upgradePersonalSubscriptionServer({ plan, returnPath });
}

export async function upgradeOrganizationSubscription({
  organizationId,
  plan,
  returnPath,
  seats,
}: {
  organizationId: string;
  plan: PaidSubscriptionPlanName;
  returnPath: string;
  seats: number;
}): Promise<Result<SubscriptionChangeResult, ActionError>> {
  return upgradeOrganizationSubscriptionServer({
    organizationId,
    plan,
    returnPath,
    seats,
  });
}

export async function openPersonalBillingPortal({
  returnPath,
}: {
  returnPath?: string;
}): Promise<Result<{ url: string }, ActionError>> {
  return openPersonalBillingPortalServer({ returnPath });
}

export async function openOrganizationBillingPortal({
  organizationId,
  returnPath,
}: {
  organizationId: string;
  returnPath: string;
}): Promise<Result<{ url: string }, ActionError>> {
  return openOrganizationBillingPortalServer({ organizationId, returnPath });
}

const updateOrganizationSubscriptionSeatsSchema = z.object({
  organizationId: z.string().min(1),
  seats: z.number().int().min(1),
});

function getErrorStatus(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const errorWithStatus = error as Error & { status?: unknown };
  return typeof errorWithStatus.status === "string"
    ? errorWithStatus.status
    : null;
}

function parseBetterAuthActionError(error: unknown): ActionError {
  const parsedBetterAuthError = betterAuthApiErrorSchema.safeParse(error);
  if (parsedBetterAuthError.success) {
    return {
      code: parsedBetterAuthError.data.body.code,
      message: parsedBetterAuthError.data.body.message,
    };
  }

  const status = getErrorStatus(error);
  if (status === "FORBIDDEN") {
    return {
      code: CommonErrorCode.UNAUTHORIZED,
      ...(error instanceof Error ? { message: error.message } : {}),
    };
  }

  if (status === "BAD_REQUEST") {
    return {
      code: CommonErrorCode.BAD_INPUT,
      ...(error instanceof Error ? { message: error.message } : {}),
    };
  }

  return {
    code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    ...(error instanceof Error ? { message: error.message } : {}),
  };
}

interface UpdateOrganizationSubscriptionSeatsParameters
  extends AuthenticatedRequest {
  organizationId: string;
  seats: number;
}

export const updateOrganizationSubscriptionSeats = withSession<
  UpdateOrganizationSubscriptionSeatsParameters,
  Result<{ seats: number }, ActionError>
>(async ({ organizationId, seats }) => {
  const parsed = updateOrganizationSubscriptionSeatsSchema.safeParse({
    organizationId,
    seats,
  });
  if (!parsed.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  try {
    const { data } = await coreClient.updateOrganizationSubscriptionSeats(
      parsed.data.organizationId,
      parsed.data.seats,
    );

    return Ok({ seats: data.seats });
  } catch (error) {
    const mappedError = mapCoreSubscriptionSeatsWriteError(error);
    if (mappedError) {
      return Err(parseBetterAuthActionError(mappedError));
    }

    if (error instanceof CoreApiRequestError) {
      return Err(toCoreApiActionError(error));
    }

    return Err(parseBetterAuthActionError(error));
  }
});
