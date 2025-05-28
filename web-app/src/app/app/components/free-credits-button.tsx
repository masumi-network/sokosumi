"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { createStripeFreeClaimCheckoutSession } from "@/lib/services";

interface FreeCreditsButtonProps {
  userId: string;
}

export default function FreeCreditsButton({ userId }: FreeCreditsButtonProps) {
  const [loading, setLoading] = useState(false);
  const t = useTranslations("App.Billing.FreeClaim");

  const handleFreeClaim = async () => {
    setLoading(true);
    try {
      const { stripeSessionId, url } =
        await createStripeFreeClaimCheckoutSession(userId);

      console.log("Checkout session created:", stripeSessionId, url);
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
