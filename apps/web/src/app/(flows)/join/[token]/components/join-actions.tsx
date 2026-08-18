"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useCollectUserName } from "@/components/auth/collect-user-name";
import { Button } from "@/components/ui/button";
import { acceptOrganizationInviteLink } from "@/lib/actions";
import { clearPendingOrganizationJoinCookieAction } from "@/lib/actions/workspace-gate";
import { activateOrganizationWorkspace } from "@/lib/activate-organization-workspace";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

interface JoinActionsProps {
  token: string;
  organizationName: string;
  organizationSlug: string;
  isAuthenticated: boolean;
  currentUserName: string;
}

export function JoinActions({
  token,
  organizationName,
  organizationSlug,
  isAuthenticated,
  currentUserName,
}: JoinActionsProps) {
  const t = useTranslations("Join");
  const router = useRouter();
  const [isJoining, setIsJoining] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const { persistIfNeeded, NameFields } = useCollectUserName(currentUserName);
  const busy = isJoining || isDeclining;

  const handleJoin = async () => {
    if (busy) return;
    setIsJoining(true);
    try {
      if (!(await persistIfNeeded())) {
        return;
      }
      const result = await acceptOrganizationInviteLink({ token });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Error.joinFailed"));
        return;
      }
      try {
        await activateOrganizationWorkspace(result.value.organizationId);
      } catch (error) {
        console.error("Failed to switch organization workspace:", error);
      }
      await clearPendingOrganizationJoinCookieAction({});
      router.push(`/organizations/${encodeURIComponent(organizationSlug)}`);
    } catch (error) {
      console.error("Failed to join organization", error);
      toast.error(t("Error.joinFailed"));
    } finally {
      setIsJoining(false);
    }
  };

  const handleDecline = async () => {
    if (busy) return;
    setIsDeclining(true);
    try {
      await clearPendingOrganizationJoinCookieAction({});
      router.push("/setup");
    } catch (error) {
      console.error("Failed to decline organization join link", error);
      toast.error(t("Error.declineFailed"));
    } finally {
      setIsDeclining(false);
    }
  };

  const goToAuth = (path: "/signin" | "/signup") => {
    const returnUrl = getReturnUrlFromCurrentLocation();
    router.push(`${path}?returnUrl=${encodeURIComponent(returnUrl)}`);
  };

  if (isAuthenticated) {
    return (
      <div className="space-y-4">
        <NameFields disabled={busy} />
        <Button
          variant="primary"
          className="w-full"
          onClick={handleJoin}
          disabled={busy}
        >
          {isJoining && <Loader2 className="size-4 animate-spin" />}
          {isJoining
            ? t("joining")
            : t("join", { organization: organizationName })}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => {
            void handleDecline();
          }}
          disabled={busy}
        >
          {isDeclining && <Loader2 className="size-4 animate-spin" />}
          {t("decline")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-center text-sm">
        {t("signedOutHint")}
      </p>
      <Button
        variant="primary"
        className="w-full"
        onClick={() => goToAuth("/signin")}
      >
        {t("signIn")}
      </Button>
      <Button
        variant="outline"
        className="w-full"
        onClick={() => goToAuth("/signup")}
      >
        {t("register")}
      </Button>
    </div>
  );
}
