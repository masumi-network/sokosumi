"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useAsyncRouter } from "@/hooks/use-async-router";
import {
  BillingErrorCode,
  claimWelcomeCredits,
  CommonErrorCode,
} from "@/lib/actions";
import { fireGTMEvent } from "@/lib/gtm-events";

interface FreeCreditsButtonProps {
  couponId: string;
}

export default function FreeCreditsButton({
  couponId,
}: FreeCreditsButtonProps) {
  const [loading, setLoading] = useState(false);
  const router = useAsyncRouter();
  const t = useTranslations("App.Billing.FreeClaim");
  const { isMobile, toggleSidebar } = useSidebar();

  const handleFreeClaim = async () => {
    setLoading(true);

    // Call appropriate action based on which prop is provided
    const result = await claimWelcomeCredits({ couponId });

    if (!result) {
      toast.error(
        "Invalid configuration - no promotion code or coupon ID provided",
      );
      setLoading(false);
      return;
    }

    if (result.ok) {
      fireGTMEvent.freeCreditStartCheckout();
      window.location.href = result.data.url;
    } else {
      switch (result.error.code) {
        case CommonErrorCode.UNAUTHENTICATED:
          toast.error(t("Errors.unauthenticated"), {
            action: {
              label: t("Errors.unauthenticatedAction"),
              onClick: async () => {
                await router.push(`/login`);
              },
            },
          });
          break;
        case BillingErrorCode.PROMOTION_CODE_NOT_FOUND:
          toast.error(t("Errors.promotionCodeNotFound"));
          break;
        default:
          toast.error(t("error"));
      }
    }
    setLoading(false);
  };

  return (
    <Button
      onClick={() => {
        handleFreeClaim();
        if (isMobile) {
          toggleSidebar();
        }
      }}
      disabled={loading}
      className="w-full md:w-auto"
    >
      {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
      {t("button")}
    </Button>
  );
}
