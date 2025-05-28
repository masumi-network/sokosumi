"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { convertCreditsToCents, getUserById } from "@/lib/db";
import { createStripeCheckoutSession } from "@/lib/services";

interface FreeCreditsButtonProps {
  userId: string;
  priceId: string;
  coupon: string;
}

export default function FreeCreditsButton({
  userId,
  priceId,
  coupon,
}: FreeCreditsButtonProps) {
  const [loading, setLoading] = useState(false);
  const t = useTranslations("App.Billing.FreeClaim");

  const handleFreeClaim = async () => {
    setLoading(true);
    try {
      const user = await getUserById(userId);
      if (!user) {
        throw new Error("User not found");
      }
      if (user.stripeCustomerId) {
        throw new Error("User already has a stripe customer id");
      }
      const { url } = await createStripeCheckoutSession(
        userId,
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
