"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { signOutWithPushRelease } from "@/lib/auth/sign-out.client";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

interface WorkspaceGateSignOutProps {
  /**
   * Handed down from the page rather than read with `useSession`. This route
   * is under `(flows)`, which mounts no `AuthSessionHydrator`, so the hook
   * starts empty: a click landing before its fetch would have released no push
   * device at all. The page already awaits the session.
   */
  userId: string;
}

export function WorkspaceGateSignOut({ userId }: WorkspaceGateSignOutProps) {
  const t = useTranslations("WorkspaceGate");
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      await signOutWithPushRelease(userId, {
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
