"use client";

import type { SessionUser } from "@sokosumi/utils";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { useCollectUserName } from "@/components/auth/collect-user-name";
import { Button } from "@/components/ui/button";
import { activateOrganizationWorkspaceWithRetry } from "@/lib/activate-organization-workspace";
import { authClient } from "@/lib/auth/auth.client";
import type { PendingInvitationDetail } from "@/lib/services/organization.service";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

interface InvitationActionsProps {
  invitation: Pick<PendingInvitationDetail, "id" | "email">;
  organizationSlug: string;
  user: SessionUser | undefined;
}

export default function InvitationActions({
  invitation,
  organizationSlug,
  user,
}: InvitationActionsProps) {
  const t = useTranslations("AcceptInvitation.InvitationCard.Actions");
  const { persistIfNeeded, NameFields } = useCollectUserName(
    user?.name?.trim() ?? "",
  );

  const { id, email } = invitation;

  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"accept" | "reject" | "logout" | null>(
    null,
  );
  const [retryOrganizationId, setRetryOrganizationId] = useState<string | null>(
    null,
  );

  const goToAuth = (path: "/signin" | "/signup") => {
    const params = new URLSearchParams();
    params.set("returnUrl", getReturnUrlFromCurrentLocation());
    params.set("email", email);
    if (path === "/signup") {
      params.set("invitationId", id);
    }
    router.push(`${path}?${params.toString()}`);
  };

  const handleAccept = async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    setAction("accept");
    if (!(await persistIfNeeded())) {
      setLoading(false);
      setAction(null);
      return;
    }
    const result = await authClient.organization.acceptInvitation({
      invitationId: id,
    });

    if (result.error) {
      const errorMessage = result.error.message ?? t("Error.accept");
      if (result.error.status === 401) {
        toast.error(errorMessage, {
          action: {
            label: t("Errors.unauthorizedAction"),
            onClick: async () => {
              const returnUrl = getReturnUrlFromCurrentLocation();
              router.push(`/signin?returnUrl=${encodeURIComponent(returnUrl)}`);
            },
          },
        });
      } else {
        toast.error(errorMessage);
      }
    } else {
      await finishAfterAccept(result.data.member.organizationId);
    }
    setLoading(false);
    setAction(null);
  };

  async function finishAfterAccept(organizationId: string) {
    const activated =
      await activateOrganizationWorkspaceWithRetry(organizationId);
    if (!activated) {
      toast.error(t("Error.activate"));
      setRetryOrganizationId(organizationId);
      return;
    }
    setRetryOrganizationId(null);
    toast.success(t("Success.accept"));
    router.push(`/organizations/${organizationSlug}`);
  }

  const handleRetryActivation = async () => {
    if (loading || !retryOrganizationId) {
      return;
    }
    setLoading(true);
    setAction("accept");
    await finishAfterAccept(retryOrganizationId);
    setLoading(false);
    setAction(null);
  };

  const handleReject = async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    setAction("reject");
    const result = await authClient.organization.rejectInvitation({
      invitationId: id,
    });

    if (result.error) {
      const errorMessage = result.error.message ?? t("Error.decline");
      if (result.error.status === 401) {
        toast.error(errorMessage, {
          action: {
            label: t("Errors.unauthorizedAction"),
            onClick: async () => {
              const returnUrl = getReturnUrlFromCurrentLocation();
              router.push(`/signin?returnUrl=${encodeURIComponent(returnUrl)}`);
            },
          },
        });
      } else {
        toast.error(errorMessage);
      }
    } else {
      toast.success(t("Success.decline"));
      router.push("/");
    }

    setLoading(false);
    setAction(null);
  };

  const handleLogout = async () => {
    setLoading(true);
    setAction("logout");
    await authClient.signOut();
    const returnUrl = getReturnUrlFromCurrentLocation();
    router.push(`/signin?returnUrl=${encodeURIComponent(returnUrl)}`);
    setLoading(false);
    setAction(null);
  };

  const handleIgnore = async () => {
    router.push("/");
  };

  if (user) {
    if (user.email === email) {
      return (
        <div className="space-y-4">
          <NameFields disabled={loading} />
          <Button
            variant="primary"
            className="w-full"
            onClick={handleAccept}
            disabled={loading || retryOrganizationId !== null}
          >
            {loading && action === "accept" && !retryOrganizationId && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {t("accept")}
          </Button>
          {retryOrganizationId ? (
            <Button
              className="w-full"
              onClick={handleRetryActivation}
              disabled={loading}
              data-testid="invitation-retry-activation"
            >
              {loading && action === "accept" && (
                <Loader2 className="size-4 animate-spin" />
              )}
              {t("activateRetry")}
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={handleReject}
            disabled={loading}
          >
            {loading && action === "reject" && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {t("decline")}
          </Button>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4">
        <p>{t("emailMismatch")}</p>
        <div className="flex justify-between gap-2 sm:gap-4">
          <Button variant="outline" onClick={handleLogout}>
            {loading && action === "logout" && (
              <Loader2 className="size-4 animate-spin" />
            )}
            {t("logout")}
          </Button>
          <Button onClick={handleIgnore}>{t("ignore")}</Button>
        </div>
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
