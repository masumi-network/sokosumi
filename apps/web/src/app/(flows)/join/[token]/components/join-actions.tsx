"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { activateOrganizationWorkspace } from "@/app/components/user-avatar/workspace-switcher";
import { Button } from "@/components/ui/button";
import { acceptOrganizationInviteLink } from "@/lib/actions";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

interface JoinActionsProps {
  token: string;
  organizationName: string;
  organizationSlug: string;
  isAuthenticated: boolean;
  /** Signed-up-through-the-link users have not answered onboarding yet. */
  hasCompletedOnboarding: boolean;
}

export function JoinActions({
  token,
  organizationName,
  organizationSlug,
  isAuthenticated,
  hasCompletedOnboarding,
}: JoinActionsProps) {
  const t = useTranslations("Join");
  const router = useRouter();
  const [isJoining, setIsJoining] = useState(false);

  const handleJoin = async () => {
    if (isJoining) return;
    setIsJoining(true);
    try {
      const result = await acceptOrganizationInviteLink({ token });
      if (!result.ok) {
        toast.error(result.error.message ?? t("Error.joinFailed"));
        return;
      }
      try {
        await activateOrganizationWorkspace(result.data.organizationId);
      } catch (error) {
        console.error("Failed to switch organization workspace:", error);
      }
      // Someone who signed up through the link has never seen onboarding.
      // Send them through its short variant instead of dropping them straight
      // into an organization page they have no context for.
      router.push(
        hasCompletedOnboarding
          ? `/organizations/${encodeURIComponent(organizationSlug)}`
          : "/onboarding",
      );
    } catch (error) {
      console.error("Failed to join organization", error);
      toast.error(t("Error.joinFailed"));
    } finally {
      setIsJoining(false);
    }
  };

  const goToAuth = (path: "/signin" | "/signup") => {
    const returnUrl = getReturnUrlFromCurrentLocation();
    router.push(`${path}?returnUrl=${encodeURIComponent(returnUrl)}`);
  };

  if (isAuthenticated) {
    return (
      <Button
        variant="primary"
        className="w-full"
        onClick={handleJoin}
        disabled={isJoining}
      >
        {isJoining && <Loader2 className="size-4 animate-spin" />}
        {isJoining
          ? t("joining")
          : t("join", { organization: organizationName })}
      </Button>
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
