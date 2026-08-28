"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { releasePushDeviceOnSignOut } from "@/lib/ably/release-push-device";
import { authClient, useSession } from "@/lib/auth/auth.client";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

export function WorkspaceGateSignOut() {
  const t = useTranslations("WorkspaceGate");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { data: session } = useSession();

  async function handleSignOut() {
    setLoading(true);
    try {
      // Before the session ends, so the deactivation can still mint a token.
      await releasePushDeviceOnSignOut(session?.user.id);
      await authClient.signOut({
        fetchOptions: {
          onError: () => {
            toast.error(t("signOutError"));
          },
          onSuccess: () => {
            const returnUrl = getReturnUrlFromCurrentLocation();
            router.push(`/signin?returnUrl=${encodeURIComponent(returnUrl)}`);
          },
        },
      });
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
