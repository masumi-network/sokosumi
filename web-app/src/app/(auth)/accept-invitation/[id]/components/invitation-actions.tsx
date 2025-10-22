"use client";

import { User } from "better-auth";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth/auth.client";
import { InvitationWithRelations } from "@/lib/db";

interface InvitationActionsProps {
  invitation: InvitationWithRelations;
  user: User | undefined;
}

export default function InvitationActions({
  invitation,
  user,
}: InvitationActionsProps) {
  const t = useTranslations("AcceptInvitation.InvitationCard.Actions");

  const { id, email, organization } = invitation;
  const { slug: organizationSlug } = organization;

  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"accept" | "reject" | "logout" | null>(
    null,
  );

  // Detect client-side rendering without setState in useEffect
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // Compute search params on client only
  const loginSearchParamsString = isClient
    ? (() => {
        const currentUrl = location.pathname + location.search;
        const loginSearchParams = new URLSearchParams();
        loginSearchParams.set("returnUrl", currentUrl);
        loginSearchParams.set("email", email);
        return loginSearchParams.toString();
      })()
    : null;

  const registerSearchParamsString = isClient
    ? (() => {
        const registerSearchParams = new URLSearchParams();
        registerSearchParams.set("email", email);
        return registerSearchParams.toString();
      })()
    : null;

  const handleAccept = async () => {
    if (loading) {
      return;
    }
    setLoading(true);
    setAction("accept");
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
              router.push("/login");
            },
          },
        });
      } else {
        toast.error(errorMessage);
      }
    } else {
      toast.success(t("Success.accept"));
      router.push(`/organizations/${organizationSlug}`);
    }
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
              router.push("/login");
            },
          },
        });
      } else {
        toast.error(errorMessage);
      }
    } else {
      toast.success(t("Success.decline"));
      router.push("/organizations");
    }

    setLoading(false);
    setAction(null);
  };

  const handleLogout = async () => {
    setLoading(true);
    setAction("logout");
    await authClient.signOut();
    router.push("/login");
    setLoading(false);
    setAction(null);
  };

  const handleIgnore = async () => {
    router.push("/organizations");
  };

  if (user) {
    if (user.email === email) {
      return (
        <CardFooter className="flex justify-between gap-2 sm:gap-4">
          <Button variant="outline" onClick={handleReject} disabled={loading}>
            {loading && action === "reject" && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {t("decline")}
          </Button>
          <Button onClick={handleAccept} disabled={loading}>
            {loading && action === "accept" && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {t("accept")}
          </Button>
        </CardFooter>
      );
    } else {
      return (
        <CardFooter className="flex flex-col gap-4">
          <p>{t("emailMismatch")}</p>
          <div className="flex justify-between gap-2 sm:gap-4">
            <Button variant="outline" onClick={handleLogout}>
              {loading && action === "logout" && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {t("logout")}
            </Button>
            <Button onClick={handleIgnore}>{t("ignore")}</Button>
          </div>
        </CardFooter>
      );
    }
  }

  return (
    <CardFooter className="flex flex-col gap-6">
      <div className="space-y-2">
        <p>{t("WithoutSession.ifYouAlreadyHaveAnAccount")}</p>
        {loginSearchParamsString ? (
          <Button variant="outline" asChild className="w-full">
            <Link href={`/login?${loginSearchParamsString}`}>
              {t("WithoutSession.login")}
            </Link>
          </Button>
        ) : (
          <Skeleton className="h-8 w-full rounded-md" />
        )}
      </div>
      <div className="space-y-2">
        <p>{t("WithoutSession.ifYouDontHaveAnAccount")}</p>
        {registerSearchParamsString ? (
          <Button variant="outline" asChild className="w-full">
            <Link href={`/register?${registerSearchParamsString}`}>
              {t("WithoutSession.register")}
            </Link>
          </Button>
        ) : (
          <Skeleton className="h-8 w-full rounded-md" />
        )}
      </div>
    </CardFooter>
  );
}
