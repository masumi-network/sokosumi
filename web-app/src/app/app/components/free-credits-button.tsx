"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useAsyncRouter } from "@/hooks/use-async-router";
import {
  BillingErrorCode,
  claimFreeCredits,
  CommonErrorCode,
} from "@/lib/actions";

export default function FreeCreditsButton() {
  const [loading, setLoading] = useState(false);
  const router = useAsyncRouter();
  const t = useTranslations("App.Billing.FreeClaim");

  const handleFreeClaim = async () => {
    setLoading(true);
    const result = await claimFreeCredits();

    if (result.ok) {
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
    <Button onClick={() => handleFreeClaim()} disabled={loading}>
      {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
      {t("button")}
    </Button>
  );
}
