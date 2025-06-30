"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { claimFreeCredits } from "@/lib/actions";

export default function FreeCreditsButton() {
  const [loading, setLoading] = useState(false);
  const t = useTranslations("App.Billing.FreeClaim");

  const handleFreeClaim = async () => {
    setLoading(true);
    const result = await claimFreeCredits();

    if (result.isOk()) {
      window.location.href = result.value.url;
    } else {
      toast.error(result.error.message);
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
