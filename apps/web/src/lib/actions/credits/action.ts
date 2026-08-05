"use server";

import { isPositiveIntegerCredits } from "@sokosumi/utils";

import { invalidatePrivateSidebarChrome } from "@/app/components/private-sidebar-cache";
import {
  type ActionError,
  CommonErrorCode,
  CreditsErrorCode,
} from "@/lib/actions/errors";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
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
>(async ({ organizationId, credits, returnPath, session }) => {
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

    // Clear private sidebar so soft nav after checkout return refetches credits.
    invalidatePrivateSidebarChrome({
      userId: session.user.id,
      organizationId:
        organizationId ?? session.session.activeOrganizationId ?? null,
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
>(async ({ organizationId, couponId, returnPath, session }) => {
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

    invalidatePrivateSidebarChrome({
      userId: session.user.id,
      organizationId:
        organizationId ?? session.session.activeOrganizationId ?? null,
    });

    return Ok({ url: data.url });
  } catch (error) {
    console.error("Failed to get free credits with coupon", error);
    if (error instanceof CouponError) {
      return Err({
        code: error.code,
      });
    }
    // Core returns 404 (unknown coupon) or 400 (not a valid credit coupon) when
    // the coupon cannot be validated/claimed; surface the specific
    // invalid-coupon message instead of a generic internal error.
    if (
      error instanceof CoreApiRequestError &&
      (error.status === 400 || error.status === 404)
    ) {
      return Err({
        message: "Invalid coupon",
        code: CreditsErrorCode.INVALID_COUPON,
      });
    }
    return Err({
      code: CommonErrorCode.INTERNAL_SERVER_ERROR,
    });
  }
});
