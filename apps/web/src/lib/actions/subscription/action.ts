"use server";

import { headers } from "next/headers";
import * as z from "zod";

import {
  ActionError,
  betterAuthApiErrorSchema,
  CommonErrorCode,
} from "@/lib/actions/errors";
import { auth } from "@/lib/auth/auth";
import { Err, Ok, Result } from "@/lib/ts-res";
import {
  AuthenticatedRequest,
  withAuthContext,
} from "@/middleware/auth-middleware";

const upgradePersonalSubscriptionSchema = z.object({
  plan: z.enum(["starter", "standard", "pro"]),
});

interface UpgradePersonalSubscriptionParameters extends AuthenticatedRequest {
  plan: "starter" | "standard" | "pro";
}

export const upgradePersonalSubscription = withAuthContext<
  UpgradePersonalSubscriptionParameters,
  Result<{ url: string }, ActionError>
>(async ({ plan }) => {
  const parsed = upgradePersonalSubscriptionSchema.safeParse({
    plan,
  });
  if (!parsed.success) {
    return Err({
      code: CommonErrorCode.BAD_INPUT,
    });
  }

  try {
    const result = await auth.api.upgradeSubscription({
      headers: await headers(),
      body: {
        plan: parsed.data.plan,
        customerType: "user",
        successUrl: "/subscriptions?status=success",
        cancelUrl: "/subscriptions?status=cancel",
        returnUrl: "/subscriptions",
        disableRedirect: true,
      },
    });

    if (!result.url) {
      return Err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
    }

    return Ok({ url: result.url });
  } catch (error) {
    const parsedBetterAuthError = betterAuthApiErrorSchema.safeParse(error);
    if (parsedBetterAuthError.success) {
      return Err({
        code: parsedBetterAuthError.data.body.code,
        message: parsedBetterAuthError.data.body.message,
      });
    }

    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});

export const openPersonalBillingPortal = withAuthContext<
  AuthenticatedRequest,
  Result<{ url: string }, ActionError>
>(async () => {
  try {
    const result = await auth.api.createBillingPortal({
      headers: await headers(),
      body: {
        customerType: "user",
        returnUrl: "/subscriptions",
        disableRedirect: true,
      },
    });

    if (!result.url) {
      return Err({
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
      });
    }

    return Ok({ url: result.url });
  } catch (error) {
    const parsedBetterAuthError = betterAuthApiErrorSchema.safeParse(error);
    if (parsedBetterAuthError.success) {
      return Err({
        code: parsedBetterAuthError.data.body.code,
        message: parsedBetterAuthError.data.body.message,
      });
    }

    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});
