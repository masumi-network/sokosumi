"use server";

import { isPositiveIntegerCredits } from "@sokosumi/utils";

import {
  type ActionError,
  CommonErrorCode,
  CreditsErrorCode,
} from "@/lib/actions/errors";
import { coreClient } from "@/lib/clients/core.client";
import { CouponError } from "@/lib/errors/coupon-errors";
import { userService } from "@/lib/services";
import { Err, Ok, type Result } from "@/lib/ts-res";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface PurchaseCreditsParameters extends AuthenticatedRequest {
  organizationId: string | null;
  credits: number;
  returnPath?: string;
}

export const purchaseCredits = withSession<
  PurchaseCreditsParameters,
  Result<{ url: string }, ActionError>
>(async ({ organizationId, credits, returnPath }) => {
  if (!isPositiveIntegerCredits(credits)) {
    return Err({
      message: "Invalid credits",
      code: CreditsErrorCode.INVALID_CREDITS,
    });
  }

  if (organizationId) {
    const member = await userService.getMyMemberInOrganization(organizationId);
    if (!member) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }
  }

  try {
    const { data } = await coreClient.createCreditCheckoutSession({
      organizationId,
      credits,
      returnPath,
    });

    return Ok({ url: data.url });
  } catch (error) {
    console.error("Failed to purchase credits", error);
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});

interface ClaimFreeCreditsWithCouponParameters extends AuthenticatedRequest {
  organizationId: string | null;
  couponId: string;
  returnPath?: string;
}

export const claimFreeCreditsWithCoupon = withSession<
  ClaimFreeCreditsWithCouponParameters,
  Result<{ url: string }, ActionError>
>(async ({ organizationId, couponId, session, returnPath }) => {
  if (organizationId) {
    const member = await userService.getMyMemberInOrganization(organizationId);
    if (!member) {
      return Err({
        message: "Unauthorized",
        code: CommonErrorCode.UNAUTHORIZED,
      });
    }
  }

  try {
    const { data: coupon } = await coreClient.getCouponDetails(couponId);
    const promo = await coreClient.claimCoupon(couponId, { organizationId });
    if (!promo.data.active) {
      return Err({
        message: "Invalid coupon",
        code: CreditsErrorCode.INVALID_COUPON,
      });
    }

    const { data } = await coreClient.createCreditCheckoutSession({
      organizationId,
      credits: coupon.credits,
      promotionCodeId: promo.data.promotionCodeId,
      returnPath: returnPath ?? "/coupon",
    });

    return Ok({ url: data.url });
  } catch (error) {
    console.error("Failed to get free credits with coupon", error);
    if (error instanceof CouponError) {
      return Err({
        code: error.code,
      });
    }
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});
