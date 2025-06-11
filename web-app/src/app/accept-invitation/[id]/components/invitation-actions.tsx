"use client";

import { User } from "better-auth";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import LogoutModal from "@/components/modals/logout-modal";
import { Button } from "@/components/ui/button";
import { CardFooter } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import useModal from "@/hooks/use-modal";
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
  const { id: organizationId, slug: organizationSlug } = organization;

  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"accept" | "reject" | null>(null);

  const [loginSearchParamsString, setLoginSearchParamsString] = useState<
    string | null
  >(null);
  const [registerSearchParamsString, setRegisterSearchParamsString] = useState<
    string | null
  >(null);

  const { Component, showModal } = useModal(({ open, onOpenChange }) => (
    <LogoutModal
      open={open}
      onOpenChange={onOpenChange}
      email={user?.email ?? ""}
    />
  ));

  useEffect(() => {
    const currentUrl = location.pathname + location.search;
    const loginSearchParams = new URLSearchParams();
    loginSearchParams.set("returnUrl", currentUrl);
    loginSearchParams.set("email", email);
    setLoginSearchParamsString(loginSearchParams.toString());

    const registerSearchParams = new URLSearchParams();
    registerSearchParams.set("email", email);
    registerSearchParams.set("organizationId", organizationId);
    setRegisterSearchParamsString(registerSearchParams.toString());
  }, [email, organizationId]);

  const handleAccept = async () => {
    if (loading) {
      return;
    }
    try {
      setLoading(true);
      setAction("accept");
      const result = await authClient.organization.acceptInvitation({
        invitationId: id,
      });

      if (result.error) {
        console.error("Failed to accept invitation", result.error);
        toast.error(t("Accept.error"));
        return;
      }

      toast.success(t("Accept.success"));
      router.push(`/app/organizations/${organizationSlug}`);
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  const handleReject = async () => {
    if (loading) {
      return;
    }
    try {
      setLoading(true);
      setAction("reject");
      const result = await authClient.organization.rejectInvitation({
        invitationId: id,
      });

      if (result.error) {
        console.error("Failed to decline invitation", result.error);
        toast.error(t("Decline.error"));
        return;
      }

      toast.success(t("Decline.success"));
      router.push("/app/organizations");
    } finally {
      setLoading(false);
      setAction(null);
    }
  };

  if (user) {
    if (user.email === email) {
      return (
        <CardFooter className="flex justify-between">
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
    }

    return (
      <>
        {Component}
        <CardFooter className="flex flex-col gap-4">
          <p>{t("WithDifferentEmail.youLoggedInWithDifferentEmail")}</p>
          <Button variant="outline" onClick={showModal} className="w-full">
            {t("WithDifferentEmail.logout")}
          </Button>
        </CardFooter>
      </>
    );
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
