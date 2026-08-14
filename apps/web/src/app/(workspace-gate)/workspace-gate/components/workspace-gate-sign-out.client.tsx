"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth/auth.client";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

export function WorkspaceGateSignOut() {
  const t = useTranslations("WorkspaceGate");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      await authClient.signOut();
      const returnUrl = getReturnUrlFromCurrentLocation();
      router.push(`/signin?returnUrl=${encodeURIComponent(returnUrl)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleSignOut}
      disabled={loading}
      data-workspace-gate-sign-out
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {t("signOut")}
    </Button>
  );
}
