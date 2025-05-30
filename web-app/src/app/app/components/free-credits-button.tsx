"use client";

import { User } from "@prisma/client";
import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { convertCreditsToCents } from "@/lib/db";
import { createStripeCheckoutSession } from "@/lib/services";

interface FreeCreditsButtonProps {
  user: User;
  priceId: string;
  coupon: string;
}

export default function FreeCreditsButton({
  user,
  priceId,
  coupon,
}: FreeCreditsButtonProps) {
  const [loading, setLoading] = useState(false);
  const t = useTranslations("App.Billing.FreeClaim");

  const handleFreeClaim = async () => {
    setLoading(true);
    try {
      // The coupon is only valid for new users
      if (user.stripeCustomerId) {
        throw new Error("User already has a stripe customer id");
      }
      const { url } = await createStripeCheckoutSession(
        user.id,
        priceId,
        convertCreditsToCents(100),
        coupon,
      );
      window.location.href = url;
    } catch (error) {
      console.error("Failed to create checkout session:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button onClick={() => handleFreeClaim()} disabled={loading}>
      {loading && <Loader2 className="mr-2 size-4 animate-spin" />}
      {t("button")}
    </Button>
  );
}
