"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { signOutWithPushRelease } from "@/lib/auth/sign-out.client";

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
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    try {
      await signOutWithPushRelease(userId, {
        fetchOptions: {
          onError: () => {
            toast.error(t("signOutError"));
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
      loading={loading}
      data-workspace-gate-sign-out
    >
      {t("signOut")}
    </Button>
  );
}
